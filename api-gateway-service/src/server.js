import fastifyCookie from "@fastify/cookie";
import fastifySession from "@fastify/session";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import underPressure from "@fastify/under-pressure";
import Fastify from "fastify";
import { config } from "./config.js";
import { createCache } from "./cache/index.js";
import { logger } from "./logger.js";
import { createSessionManager } from "./server/session-manager.js";
import { createCorsHelpers } from "./server/cors.js";
import { createRoutingHelpers } from "./server/routing.js";
import {
  sanitizeRequestHeaders,
  sanitizeResponseHeaders,
  sanitizeHeadersForCache,
  resolveClientIp,
  appendForwardedFor,
  findHeaderKey,
} from "./server/headers.js";
import { createProxyHandler } from "./server/proxy.js";
import { createRequestContextManager } from "./server/request-context.js";

const RADIO_PREFIX = "/radio";
const TERMINAL_PREFIX = "/terminal";
const SESSION_COOKIE_NAME = config.session.cookieName;
const SESSION_TTL_SECONDS = Math.floor(config.session.maxAgeMs / 1000);

const cache = createCache(config.cache);

const sessionManager = await createSessionManager(config, logger);
const {
  sessionSecret: SESSION_SECRET,
  sessionStore,
  initializeSession,
  persistSession,
  validateSession,
  recordIssuedSession,
  shutdown: shutdownSessionManager,
} = sessionManager;

const { buildCorsHeaders, isOriginAllowed, handlePreflight } = createCorsHelpers(config);

const {
  parseRequestUrl,
  determineTarget,
  shouldCacheRequest,
  buildCacheKey,
  validateBaseUrls,
} = createRoutingHelpers({
  config,
  logger,
  radioPrefix: RADIO_PREFIX,
  terminalPrefix: TERMINAL_PREFIX,
});

validateBaseUrls();

const { createRequestContext, completeRequest } = createRequestContextManager(logger);

const fastify = Fastify({
  trustProxy: config.trustProxy,
});

const sessionResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["csrfToken", "csrfProof", "expiresAt"],
  properties: {
    csrfToken: { type: "string" },
    csrfProof: { type: "string" },
    expiresAt: { type: "number" },
  },
};

const errorResponseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    error: { type: "string" },
  },
};

fastify.register(fastifyCookie, {
  secret: SESSION_SECRET,
  parseOptions: {
    sameSite: "strict",
    httpOnly: true,
    secure: true,
    path: "/",
  },
});

fastify.register(swagger, {
  openapi: {
    info: {
      title: "Gateway API",
      description: "Documentation for the API gateway proxy endpoints.",
      version: "0.1.0",
    },
    tags: [
      { name: "Proxy", description: "Routes proxied to downstream services." },
      { name: "Session", description: "Session issuance endpoints." },
      { name: "Health", description: "Readiness and liveness endpoints." },
    ],
    servers: [
      {
        url: "/api",
        description: "External API base path",
      },
    ],
  },
});

fastify.register(swaggerUi, {
  routePrefix: "/docs",
  uiConfig: {
    docExpansion: "list",
    deepLinking: false,
  },
});

fastify.register(fastifySession, {
  secret: SESSION_SECRET,
  cookieName: SESSION_COOKIE_NAME,
  saveUninitialized: false,
  rolling: false,
  store: sessionStore ?? undefined,
  cookie: {
    sameSite: "strict",
    httpOnly: true,
    secure: true,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  },
});

fastify.register(underPressure, {
  maxEventLoopDelay: 1000,
  healthCheckInterval: 30000,
  exposeStatusRoute: {
    url: "/internal/status",
    routeOpts: {
      logLevel: "warn",
      schema: {
        summary: "Runtime status metrics",
        description: "Reports gateway resource usage for liveness probes.",
        tags: ["Health"],
      },
    },
  },
  healthCheck: async () => ({
    uptime: process.uptime(),
  }),
});

fastify.addHook("onRequest", (request, _reply, done) => {
  createRequestContext(request);
  done();
});

fastify.addHook("onResponse", (request, reply, done) => {
  if (request.appContext && !request.appContext.completed) {
    completeRequest(request, reply.statusCode);
  }
  done();
});

fastify.removeContentTypeParser("application/json");
fastify.addContentTypeParser(
  "application/json",
  { parseAs: "string" },
  (request, body, done) => {
    if (body === "" || body === null || body === undefined) {
      done(null, {});
      return;
    }

    try {
      const parsed = JSON.parse(body);
      done(null, parsed);
    } catch (error) {
      done(error);
    }
  },
);

fastify.options("/session", (request, reply) => {
  const corsHeaders = buildCorsHeaders(request.headers.origin);
  reply
    .headers({
      ...corsHeaders,
      "Access-Control-Max-Age": "600",
    })
    .code(204)
    .send();
  completeRequest(request, 204, { route: "session", method: "OPTIONS" });
});

fastify.post("/session", {
  schema: {
    tags: ["Session"],
    summary: "Issue a session cookie",
    description: "Generates a new session token and CSRF nonce for downstream requests.",
    response: {
      200: sessionResponseSchema,
      403: errorResponseSchema,
      500: errorResponseSchema,
    },
  },
}, async (request, reply) => {
  const originAllowed = isOriginAllowed(request.headers.origin ?? null);
  const corsHeaders = buildCorsHeaders(request.headers.origin);

  logger.info("session.request_received", {
    hasCookie: Boolean(request.headers.cookie),
    cookies: request.headers.cookie ?? null,
  });

  if (!originAllowed) {
    reply
      .headers({
        ...corsHeaders,
        "Content-Type": "application/json",
      })
      .code(403)
      .send({ error: "Origin not allowed" });
    completeRequest(request, 403, { route: "session", reason: "origin-denied" });
    return;
  }

  const sessionInfo = initializeSession(request.session);
  try {
    await persistSession(request.session);
    await recordIssuedSession(sessionInfo);
  } catch (error) {
    logger.error("session.persist_failed", { error });
    reply
      .headers({
        ...corsHeaders,
        "Content-Type": "application/json",
      })
      .code(500)
      .send({ error: "Failed to initialize session" });
    completeRequest(request, 500, { route: "session", reason: "persist-failed" });
    return;
  }

  reply
    .headers({
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    })
    .code(200)
    .send({
      csrfToken: sessionInfo.nonce,
      csrfProof: sessionInfo.csrfProof,
      expiresAt: sessionInfo.expiresAt,
    });

  logger.info("session.response_headers", {
    setCookie: reply.getHeader("set-cookie") ?? null,
  });
  completeRequest(request, 200, {
    route: "session",
    expiresAt: sessionInfo.expiresAt,
  });
});

fastify.route({
  method: ["GET", "PUT", "PATCH", "DELETE", "HEAD"],
  url: "/session",
  handler: (request, reply) => {
    const corsHeaders = buildCorsHeaders(request.headers.origin);
    reply
      .headers({
        ...corsHeaders,
        "Content-Type": "application/json",
      })
      .code(405)
      .send({ error: "Method Not Allowed" });
    completeRequest(request, 405, { route: "session", reason: "method-not-allowed" });
  },
});

fastify.get("/healthz", {
  schema: {
    tags: ["Health"],
    summary: "Gateway health check",
    description: "Returns status information for readiness probes.",
    response: {
      200: {
        type: "object",
        additionalProperties: false,
        properties: {
          status: { type: "string", enum: ["ok"] },
        },
      },
    },
  },
}, async (request, reply) => {
  reply.send({ status: "ok" });
  completeRequest(request, 200, { route: "healthz" });
});

const { proxyRequest } = createProxyHandler({
  config,
  cache,
  logger,
  helpers: {
    sanitizeRequestHeaders,
    sanitizeResponseHeaders,
    sanitizeHeadersForCache,
    resolveClientIp,
    appendForwardedFor,
    findHeaderKey,
  },
});

fastify.all("*", async (request, reply) => {
  await handleGatewayRequest(request, reply);
});

async function handleGatewayRequest(request, reply) {
  const req = request.raw;
  const res = reply.raw;
  const requestContext = request.appContext?.baseContext ?? {};
  reply.hijack();

  const complete = (statusCode, details = {}) => {
    completeRequest(request, statusCode, details);
  };

  const parsedUrlResult = parseRequestUrl(req.url);
  if (!parsedUrlResult.ok) {
    logger.warn("request.invalid_url", {
      ...requestContext,
      reason: parsedUrlResult.reason,
    });
    res.writeHead(parsedUrlResult.statusCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: parsedUrlResult.error }));
    complete(parsedUrlResult.statusCode, { reason: "invalid-url" });
    return;
  }

  const url = parsedUrlResult.url;
  requestContext.pathname = url.pathname;

  if (req.method === "OPTIONS") {
    handlePreflight(req, res);
    complete(204, { route: "preflight" });
    return;
  }

  const target = determineTarget(url.pathname, requestContext);
  if (!target) {
    const corsHeaders = buildCorsHeaders(req.headers.origin);
    logger.warn("request.route_not_found", {
      ...requestContext,
    });
    res.writeHead(404, {
      "Content-Type": "application/json",
      ...corsHeaders,
    });
    res.end(JSON.stringify({ error: "Not Found" }));
    complete(404, { reason: "route-not-found" });
    return;
  }

  requestContext.targetService = target.service;
  requestContext.targetPath = target.path;
  requestContext.targetBaseUrl = target.baseUrl;

  const corsHeaders = buildCorsHeaders(req.headers.origin);
  if (!isOriginAllowed(req.headers.origin ?? null)) {
    logger.warn("request.origin_denied", {
      ...requestContext,
      origin: req.headers.origin ?? null,
    });
    res.writeHead(403, {
      "Content-Type": "application/json",
      ...corsHeaders,
    });
    res.end(JSON.stringify({ error: "Origin not allowed" }));
    complete(403, { route: target.service, reason: "origin-denied" });
    return;
  }

  const docsAccess =
    (target.service === "radio" || target.service === "terminal") && target.path.startsWith("/docs");

  let sessionValidation;
  if (docsAccess) {
    const result = await validateSession(request, url);
    sessionValidation = result.ok ? result : { ok: true, session: null };
  } else {
    sessionValidation = await validateSession(request, url);
  }
  if (!sessionValidation.ok) {
    const sessionSnapshot =
      request.session && typeof request.session === "object"
        ? Object.fromEntries(
            Object.entries(request.session).filter(([key]) => key !== "cookie"),
          )
        : null;
    logger.warn("session.validation_failed", {
      ...requestContext,
      statusCode: sessionValidation.statusCode,
      error: sessionValidation.error,
      hasSessionCookie: Boolean(req.headers.cookie),
      sessionCookieNames: req.headers.cookie
        ? req.headers.cookie
            .split(";")
            .map((part) => part.trim().split("=")[0])
        : [],
      sessionSnapshot,
    });
    res.writeHead(sessionValidation.statusCode, {
      "Content-Type": "application/json",
      ...corsHeaders,
    });
    res.end(JSON.stringify({ error: sessionValidation.error }));
    complete(sessionValidation.statusCode, {
      route: target.service,
      reason: "invalid-session",
    });
    return;
  }

  const cacheable = shouldCacheRequest(req, target);
  const cacheKey = cacheable ? buildCacheKey(req, target, url) : null;
  if (cacheable && cacheKey) {
    try {
      const cachedRaw = await cache.get(cacheKey);
      if (cachedRaw) {
        const cached = JSON.parse(cachedRaw);
        res.writeHead(cached.status ?? 200, {
          ...(cached.headers ?? {}),
          ...corsHeaders,
          "X-Cache": "HIT",
        });
        res.end(cached.body ?? "");
        logger.info("cache.hit", { ...requestContext, cacheKey });
        complete(cached.status ?? 200, {
          route: target.service,
          cache: "HIT",
        });
        return;
      }
    } catch (error) {
      logger.warn("cache.read_error", {
        ...requestContext,
        cacheKey,
        error,
      });
    }
  }

  const proxyResult = await proxyRequest(
    request,
    res,
    target,
    sessionValidation.session,
    corsHeaders,
    {
      cacheable,
      cacheKey,
    },
    url,
    requestContext,
  );

  const completionDetails = {
    route: target.service,
    cache: cacheable ? proxyResult?.cacheStatus ?? "MISS" : "BYPASS",
  };
  if (proxyResult?.error) {
    completionDetails.error = proxyResult.error;
  }
  complete(proxyResult?.status ?? 500, completionDetails);
}

async function start() {
  try {
    await fastify.listen({ port: config.port, host: "0.0.0.0" });
    logger.info("server.started", {
      port: config.port,
      radioServiceUrl: config.radioServiceUrl,
      terminalServiceUrl: config.terminalServiceUrl,
    });
  } catch (error) {
    logger.error("server.start_failed", { error });
    process.exit(1);
  }
}

start();

async function shutdown() {
  try {
    await fastify.close();
  } catch (error) {
    logger.warn("server.close_failed", { error });
  }

  try {
    await cache.shutdown();
  } catch (error) {
    logger.warn("cache.shutdown_error", { error });
  }

  try {
    await shutdownSessionManager();
  } catch (error) {
    logger.warn("session.manager_shutdown_failed", { error });
  }

  process.exit(0);
}

process.on("SIGINT", () => {
  shutdown().catch((error) => {
    logger.error("shutdown.unhandled_error", { error });
    process.exit(1);
  });
});

process.on("SIGTERM", () => {
  shutdown().catch((error) => {
    logger.error("shutdown.unhandled_error", { error });
    process.exit(1);
  });
});
