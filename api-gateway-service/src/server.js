import Fastify from "fastify";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { config } from "./config.js";
import { createCache } from "./cache/index.js";
import { logger } from "./logger.js";

const ALLOWED_SERVICE_HOSTNAMES = new Set(config.allowedServiceHostnames);
const RADIO_PREFIX = "/radio";
const TERMINAL_PREFIX = "/terminal";
const SESSION_COOKIE_NAME = config.session.cookieName;
const SESSION_MAX_AGE_MS = config.session.maxAgeMs;
const SESSION_SECRET = config.session.secret;

const ABSOLUTE_URL_PATTERN = /^[a-z][a-z0-9+.-]*:/i;
const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/;

const VALID_PREFIXES = [RADIO_PREFIX, TERMINAL_PREFIX];
const cache = createCache(config.cache);

function buildCorsHeaders(origin) {
  const allowed = config.allowOrigins;
  const wildcard = allowed.includes("*");
  if (!origin) {
    const headers = { Vary: "Origin" };
    if (allowed.length === 0 || wildcard) {
      return headers;
    }
    return headers;
  }

  if (allowed.length === 0 || wildcard || allowed.includes(origin)) {
    const headers = {
      Vary: "Origin",
      "Access-Control-Allow-Origin": wildcard ? "*" : origin,
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,PATCH,OPTIONS",
      "Access-Control-Allow-Headers": "authorization,content-type,x-gateway-csrf",
    };

    if (!wildcard) {
      headers["Access-Control-Allow-Credentials"] = "true";
    }

    return headers;
  }

  return { Vary: "Origin" };
}

function isOriginAllowed(origin) {
  const allowed = config.allowOrigins;
  if (allowed.length === 0 || allowed.includes("*")) {
    return true;
  }
  if (!origin) {
    return false;
  }
  return allowed.includes(origin);
}

function handlePreflight(req, res) {
  const headers = buildCorsHeaders(req.headers.origin);
  res.writeHead(204, {
    ...headers,
    "Access-Control-Max-Age": "600",
  });
  res.end();
}

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailer",
  "proxy-authorization",
  "proxy-authenticate",
  "host",
  "content-length",
  "expect",
]);

function decodeUntilStable(value) {
  let current = value;
  for (let i = 0; i < 3; i += 1) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) {
        return current;
      }
      current = decoded;
    } catch (error) {
      return current;
    }
  }
  return current;
}

function containsTraversal(value) {
  return (
    value.includes("..") ||
    value.includes("\\") ||
    value.includes("//") ||
    /%2e%2f|%2f%2e|%5c|%2f%2f|%2e%2e/i.test(value)
  );
}

function parseRequestUrl(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) {
    return { ok: false, statusCode: 400, error: "Missing request URL", reason: "missing" };
  }
  if (CONTROL_CHAR_PATTERN.test(rawUrl) || rawUrl.includes("\\")) {
    return { ok: false, statusCode: 400, error: "Invalid request URL", reason: "invalid-characters" };
  }
  if (ABSOLUTE_URL_PATTERN.test(rawUrl) || rawUrl.startsWith("//")) {
    return { ok: false, statusCode: 400, error: "Invalid request URL", reason: "absolute-form" };
  }
  let parsed;
  try {
    parsed = new URL(rawUrl, "http://localhost");
  } catch {
    return { ok: false, statusCode: 400, error: "Invalid request URL", reason: "parse-failed" };
  }
  if (
    parsed.hostname !== "localhost" ||
    parsed.port ||
    parsed.username ||
    parsed.password
  ) {
    return { ok: false, statusCode: 400, error: "Invalid request URL", reason: "unexpected-authority" };
  }
  return { ok: true, url: parsed };
}

function sanitizePath(prefix, rawSuffix, context = {}) {
  if (!VALID_PREFIXES.includes(prefix)) {
    return null;
  }
  // Only allow single leading slash, prohibit path traversal, encoded traversal, backslashes, double slashes
  let suffix = rawSuffix || "/";
  if (!suffix.startsWith("/")) suffix = "/" + suffix;
  // Prohibit path traversal attempts even if encoded
  const decoded = decodeUntilStable(suffix);
  if (containsTraversal(suffix) || containsTraversal(decoded)) {
    logger.warn("request.blocked_ssrf_attempt", {
      ...context,
      prefix,
      suffix,
    });
    return null;
  }
  // Optionally normalize: collapse multiple slashes
  suffix = suffix.replace(/\/{2,}/g, "/");
  return suffix;
}

function determineTarget(pathname, context = {}) {
  if (pathname === RADIO_PREFIX || pathname.startsWith(`${RADIO_PREFIX}/`)) {
    const rawSuffix = pathname.slice(RADIO_PREFIX.length) || "/";
    const sanitized = sanitizePath(RADIO_PREFIX, rawSuffix, context);
    if (!sanitized) return null;
    return {
      baseUrl: config.radioServiceUrl,
      path: sanitized,
      service: "radio",
    };
  }

  if (pathname === TERMINAL_PREFIX || pathname.startsWith(`${TERMINAL_PREFIX}/`)) {
    const rawSuffix = pathname.slice(TERMINAL_PREFIX.length) || "/";
    const sanitized = sanitizePath(TERMINAL_PREFIX, rawSuffix, context);
    if (!sanitized) return null;
    return {
      baseUrl: config.terminalServiceUrl,
      path: sanitized,
      service: "terminal",
    };
  }

  return null;
}

function sanitizeRequestHeaders(headers) {
  const result = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!value) continue;
    const lowerKey = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lowerKey)) continue;
    result[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  return result;
}

function sanitizeResponseHeaders(headers) {
  const result = {};
  headers.forEach((value, key) => {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) return;
    result[key] = value;
  });
  return result;
}

function sanitizeHeadersForCache(headers) {
  const filtered = { ...headers };
  for (const key of Object.keys(filtered)) {
    const lower = key.toLowerCase();
    if (lower === "set-cookie" || lower === "set-cookie2" || lower === "content-length") {
      delete filtered[key];
    }
  }
  return filtered;
}

function shouldCacheRequest(req, target) {
  if (req.method !== "GET" || !target) {
    return false;
  }
  if (target.service === "radio" && target.path.startsWith("/stations")) {
    return true;
  }
  return false;
}

function buildCacheKey(req, target, parsedUrl) {
  const parsed = parsedUrl ?? new URL(req.url ?? "/", "http://localhost");
  const params = Array.from(parsed.searchParams.entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const serialized =
    params.length > 0 ? params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&") : "";
  const suffix = serialized.length > 0 ? `?${serialized}` : "";
  return `${target.service}:${target.path}${suffix}`;
}

if (ALLOWED_SERVICE_HOSTNAMES.size === 0) {
  logger.error("config.allowed_service_hostnames_missing", {});
  process.exit(1);
}

function validateBaseUrl(serviceName, serviceUrl) {
  let parsed;
  try {
    parsed = new URL(serviceUrl);
  } catch (error) {
    throw new Error(`Invalid ${serviceName}: ${serviceUrl}`);
  }
  if (!ALLOWED_SERVICE_HOSTNAMES.has(parsed.hostname)) {
    throw new Error(
      `Blocked SSRF risk for ${serviceName}: hostname "${parsed.hostname}" is not allowed. Allowed: ${Array.from(
        ALLOWED_SERVICE_HOSTNAMES,
      ).join(", ")}`,
    );
  }
  return parsed;
}

try {
  validateBaseUrl("radioServiceUrl", config.radioServiceUrl);
  validateBaseUrl("terminalServiceUrl", config.terminalServiceUrl);
} catch (error) {
  logger.error("config.invalid_base_url", { error });
  process.exit(1);
}

function parseCookies(headerValue) {
  const cookies = {};
  if (!headerValue) {
    return cookies;
  }
  const parts = Array.isArray(headerValue) ? headerValue : [headerValue];
  for (const part of parts) {
    const segments = part.split(";").map((segment) => segment.trim());
    for (const segment of segments) {
      if (!segment) continue;
      const eqIndex = segment.indexOf("=");
      if (eqIndex === -1) continue;
      const name = segment.slice(0, eqIndex).trim();
      const value = segment.slice(eqIndex + 1).trim();
      if (name) {
        cookies[name] = value;
      }
    }
  }
  return cookies;
}

function serializeSessionCookie(nonce, timestamp, signature) {
  const parts = [
    `${SESSION_COOKIE_NAME}=${nonce}.${timestamp}.${signature}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    `Max-Age=${Math.floor(SESSION_MAX_AGE_MS / 1000)}`,
  ];
  return parts.join("; ");
}

function createSessionSignature(nonce, timestamp) {
  const hmac = crypto.createHmac("sha256", SESSION_SECRET);
  hmac.update(nonce);
  hmac.update("|");
  hmac.update(String(timestamp));
  return hmac.digest("hex");
}

function timingSafeEqualHex(a, b) {
  try {
    const bufA = Buffer.from(a, "hex");
    const bufB = Buffer.from(b, "hex");
    if (bufA.length !== bufB.length) {
      return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

function issueSession() {
  const nonce = crypto.randomBytes(16).toString("hex");
  const issuedAt = Date.now();
  const signature = createSessionSignature(nonce, issuedAt);
  const cookie = serializeSessionCookie(nonce, issuedAt, signature);
  return {
    token: nonce,
    cookie,
    expiresAt: issuedAt + SESSION_MAX_AGE_MS,
  };
}

function extractHeaderValue(headers, target) {
  const key = findHeaderKey(headers, target);
  if (!key) return null;
  const raw = headers[key];
  if (Array.isArray(raw)) {
    return raw.length > 0 ? raw[0] : null;
  }
  return typeof raw === "string" ? raw : null;
}

function validateSession(req, parsedUrl) {
  const cookies = parseCookies(req.headers.cookie);
  const rawValue = cookies[SESSION_COOKIE_NAME];
  if (!rawValue) {
    return { ok: false, statusCode: 401, error: "Session required" };
  }

  const [nonce, timestampStr, signature] = rawValue.split(".");
  if (!nonce || !timestampStr || !signature) {
    return { ok: false, statusCode: 401, error: "Invalid session" };
  }

  const timestamp = Number.parseInt(timestampStr, 10);
  if (!Number.isFinite(timestamp)) {
    return { ok: false, statusCode: 401, error: "Invalid session" };
  }

  if (Date.now() - timestamp > SESSION_MAX_AGE_MS) {
    return { ok: false, statusCode: 401, error: "Session expired" };
  }

  const expectedSignature = createSessionSignature(nonce, timestamp);
  if (!timingSafeEqualHex(signature, expectedSignature)) {
    return { ok: false, statusCode: 401, error: "Session verification failed" };
  }

  const csrfHeader = extractHeaderValue(req.headers, "x-gateway-csrf");
  let csrfToken = typeof csrfHeader === "string" && csrfHeader.trim().length > 0 ? csrfHeader.trim() : null;
  if (!csrfToken && parsedUrl) {
    const param = parsedUrl.searchParams.get("csrfToken");
    if (typeof param === "string" && param.trim().length > 0) {
      csrfToken = param.trim();
    }
  }

  const method = (req.method ?? "").toUpperCase();
  const csrfRequired = method !== "OPTIONS";
  if (csrfRequired) {
    if (!csrfToken || csrfToken !== nonce) {
      return { ok: false, statusCode: 403, error: "Missing or invalid CSRF token" };
    }
  }

  return { ok: true, session: { nonce, timestamp } };
}

function buildProxyRequestBody(req, signal) {
  if (req.method === "GET" || req.method === "HEAD") {
    return null;
  }

  if (signal.aborted) {
    req.destroy(new Error("Request aborted"));
    return null;
  }

  signal.addEventListener(
    "abort",
    () => {
      req.destroy(new Error("Request aborted"));
    },
    { once: true },
  );

  return Readable.toWeb(req);
}

async function proxyRequest(
  req,
  res,
  target,
  session,
  corsHeaders,
  cacheOptions,
  parsedUrl,
  requestContext,
) {
  const parsed = parsedUrl ?? new URL(req.url ?? "/", "http://localhost");
  const targetUrl = new URL(target.path + parsed.search, `${target.baseUrl}`);
  const allowedHostname = new URL(target.baseUrl).hostname;
  if (
    (targetUrl.protocol !== "https:" && targetUrl.protocol !== "http:") ||
    targetUrl.hostname !== allowedHostname
  ) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Upstream target rejected" }));
    return;
  }

  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), config.requestTimeoutMs);

  try {
    const body = buildProxyRequestBody(req, abort.signal);

    const outgoingHeaders = sanitizeRequestHeaders(req.headers);
    const { ip: clientIp, source: clientIpSource } = resolveClientIp(req);
    if (session?.nonce) {
      outgoingHeaders["X-Gateway-Session"] = session.nonce;
    }
    if (clientIp) {
      const connectingKey = findHeaderKey(outgoingHeaders, "cf-connecting-ip");
      const connectionKey = findHeaderKey(outgoingHeaders, "cf-connection-ip");
      if (clientIpSource === "cf-connection-ip") {
        if (connectionKey) {
          outgoingHeaders[connectionKey] = clientIp;
        } else {
          outgoingHeaders["CF-Connection-IP"] = clientIp;
        }
        if (connectingKey) {
          outgoingHeaders[connectingKey] = clientIp;
        } else {
          outgoingHeaders["CF-Connecting-IP"] = clientIp;
        }
      } else {
        if (connectingKey) {
          outgoingHeaders[connectingKey] = clientIp;
        } else {
          outgoingHeaders["CF-Connecting-IP"] = clientIp;
        }
        if (connectionKey) {
          outgoingHeaders[connectionKey] = clientIp;
        } else {
          outgoingHeaders["CF-Connection-IP"] = clientIp;
        }
      }
      outgoingHeaders["X-Real-IP"] = clientIp;
    }
    appendForwardedFor(outgoingHeaders, req.socket?.remoteAddress ?? null);

    const fetchOptions = {
      method: req.method,
      headers: outgoingHeaders,
      signal: abort.signal,
    };

    if (body != null) {
      fetchOptions.body = body;
      fetchOptions.duplex = "half";
    }

    const upstreamResponse = await fetch(targetUrl, fetchOptions);

    const headers = sanitizeResponseHeaders(upstreamResponse.headers);
    const cacheable =
      cacheOptions?.cacheable &&
      (upstreamResponse.status === 200 || upstreamResponse.status === 204) &&
      typeof headers["content-type"] === "string" &&
      headers["content-type"].includes("application/json");
    const bufferedChunks = cacheable ? [] : null;
    const responseHeaders = {
      ...headers,
      ...corsHeaders,
      "X-Cache": cacheOptions?.cacheable ? "MISS" : "BYPASS",
    };

    res.writeHead(upstreamResponse.status, responseHeaders);

    if (upstreamResponse.body) {
      for await (const chunk of upstreamResponse.body) {
        res.write(chunk);
        if (bufferedChunks) {
          bufferedChunks.push(Buffer.from(chunk));
        }
      }
    }
    res.end();

    if (bufferedChunks && cacheOptions?.cacheKey) {
      try {
        const payloadBuffer = Buffer.concat(bufferedChunks);
        const cacheRecord = JSON.stringify({
          status: upstreamResponse.status,
          headers: sanitizeHeadersForCache(headers),
          body: payloadBuffer.toString("utf8"),
        });
        await cache.set(cacheOptions.cacheKey, cacheRecord, config.cache.ttlSeconds);
      } catch (error) {
        logger.warn("cache.store_error", {
          ...requestContext,
          cacheKey: cacheOptions.cacheKey,
          error,
        });
      }
    }

    return {
      status: upstreamResponse.status,
      cacheStatus: cacheOptions?.cacheable ? "MISS" : "BYPASS",
    };
  } catch (error) {
    const status = error.name === "AbortError" ? 504 : 502;
    logger.error("proxy.error", {
      ...requestContext,
      status,
      target: target.baseUrl,
      error,
    });
    if (!res.headersSent) {
      res.writeHead(status, {
        "Content-Type": "application/json",
        ...corsHeaders,
      });
    }
    if (!res.writableEnded) {
      if (!res.headersSent) {
        res.end(JSON.stringify({ error: "Upstream request failed" }));
      } else {
        res.end();
      }
    }
    return { status, error };
  } finally {
    clearTimeout(timeout);
  }
}

function findHeaderKey(headers, target) {
  const lowerTarget = target.toLowerCase();
  return Object.keys(headers).find((key) => key.toLowerCase() === lowerTarget) ?? null;
}

function appendForwardedFor(headers, remoteAddress) {
  if (!remoteAddress) {
    return;
  }
  const normalized = normalizeAddress(remoteAddress);
  if (!normalized) {
    return;
  }
  const existingKey = findHeaderKey(headers, "x-forwarded-for");
  if (existingKey) {
    const parts = headers[existingKey]
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    if (!parts.includes(normalized)) {
      parts.push(normalized);
    }
    headers[existingKey] = parts.join(", ");
  } else {
    headers["X-Forwarded-For"] = normalized;
  }
}

function normalizeAddress(address) {
  if (!address) return null;
  if (address.startsWith("::ffff:")) {
    return address.slice(7);
  }
  if (address === "::1") {
    return "127.0.0.1";
  }
  return address;
}

function resolveClientIp(req) {
  const headerCandidates = ["cf-connecting-ip", "cf-connection-ip"];
  for (const header of headerCandidates) {
    const raw = extractHeaderValue(req.headers, header);
    if (typeof raw === "string" && raw.trim().length > 0) {
      const normalized = normalizeAddress(raw.trim());
      if (normalized) {
        return { ip: normalized, source: header };
      }
    }
  }

  const forwardedRaw = extractHeaderValue(req.headers, "x-forwarded-for");
  if (forwardedRaw && forwardedRaw.trim().length > 0) {
    const first = forwardedRaw.split(",")[0].trim();
    const normalized = normalizeAddress(first);
    if (normalized) {
      return { ip: normalized, source: "x-forwarded-for" };
    }
  }

  const socketAddress = normalizeAddress(req.socket?.remoteAddress ?? null);
  if (socketAddress) {
    return { ip: socketAddress, source: "remote-address" };
  }

  return { ip: null, source: null };
}

function createRequestContext(request) {
  const req = request.raw;
  const requestIdHeader = req.headers["x-request-id"];
  const requestId =
    typeof requestIdHeader === "string" && requestIdHeader.trim().length > 0
      ? requestIdHeader.trim()
      : crypto.randomUUID();
  const baseContext = {
    requestId,
    method: req.method,
    rawUrl: req.url ?? null,
    origin: req.headers.origin ?? null,
    remoteAddress: req.socket?.remoteAddress ?? null,
  };
  request.appContext = {
    baseContext,
    startedAt: process.hrtime.bigint(),
    completed: false,
  };
  logger.info("request.received", baseContext);
}

function completeRequest(request, statusCode, details = {}) {
  const context = request.appContext;
  if (!context || context.completed) {
    return;
  }
  context.completed = true;
  const durationMs = Number(process.hrtime.bigint() - context.startedAt) / 1_000_000;
  logger.info("request.completed", {
    ...context.baseContext,
    statusCode,
    durationMs,
    ...details,
  });
}

const fastify = Fastify({
  trustProxy: config.trustProxy,
});

fastify.addHook("onRequest", (request, _reply, done) => {
  createRequestContext(request);
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

fastify.all("*", async (request, reply) => {
  reply.hijack();
  await handleGatewayRequest(request, reply);
});

async function handleGatewayRequest(request, reply) {
  const req = request.raw;
  const res = reply.raw;
  const requestContext = request.appContext?.baseContext ?? {};

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

  if (url.pathname === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    complete(200, { route: "healthz" });
    return;
  }

  if (url.pathname === "/session") {
    const originAllowed = isOriginAllowed(req.headers.origin ?? null);
    const corsHeaders = buildCorsHeaders(req.headers.origin);

    if (!originAllowed) {
      logger.warn("session.origin_denied", {
        ...requestContext,
        origin: req.headers.origin ?? null,
      });
      res.writeHead(403, {
        "Content-Type": "application/json",
        ...corsHeaders,
      });
      res.end(JSON.stringify({ error: "Origin not allowed" }));
      complete(403, { route: "session", reason: "origin-denied" });
      return;
    }

    if (req.method !== "POST") {
      logger.warn("session.method_not_allowed", {
        ...requestContext,
        origin: req.headers.origin ?? null,
      });
      res.writeHead(405, {
        "Content-Type": "application/json",
        ...corsHeaders,
      });
      res.end(JSON.stringify({ error: "Method Not Allowed" }));
      complete(405, { route: "session", reason: "method-not-allowed" });
      return;
    }

    const sessionResponse = issueSession();
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Set-Cookie": sessionResponse.cookie,
      ...corsHeaders,
    });
    res.end(
      JSON.stringify({
        csrfToken: sessionResponse.token,
        expiresAt: sessionResponse.expiresAt,
      }),
    );
    complete(200, {
      route: "session",
      expiresAt: sessionResponse.expiresAt,
    });
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

  const sessionValidation = validateSession(req, url);
  if (!sessionValidation.ok) {
    logger.warn("session.validation_failed", {
      ...requestContext,
      statusCode: sessionValidation.statusCode,
      error: sessionValidation.error,
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
    req,
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
  } finally {
    process.exit(0);
  }
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
