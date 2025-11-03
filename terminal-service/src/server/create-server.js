import fastifyCors from "@fastify/cors";
import fastifyHelmet from "@fastify/helmet";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import underPressure from "@fastify/under-pressure";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { config } from "../config.js";

function createRequestContext(request, logger) {
  const req = request.raw;
  const requestIdHeader = req.headers["x-request-id"];
  const requestId =
    typeof requestIdHeader === "string" && requestIdHeader.trim().length > 0
      ? requestIdHeader.trim()
      : randomUUID();
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

function completeRequest(request, logger, statusCode, details = {}) {
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

export function createServer({ logger, commandHandlers }) {
  const { handleExecute, handleInfo } = commandHandlers;

  const fastify = Fastify({
    bodyLimit: config.maxPayloadBytes,
  });

  fastify.register(swagger, {
    openapi: {
      info: {
        title: "Terminal Service API",
        description: "Sandbox terminal command execution and metadata endpoints.",
        version: "0.1.0",
      },
      tags: [
        { name: "Terminal", description: "Interact with the sandbox shell." },
        { name: "Health", description: "Operational health and status checks." },
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

  fastify.register(underPressure, {
    maxEventLoopDelay: 1000,
    healthCheckInterval: 30000,
    exposeStatusRoute: {
      url: "/internal/status",
      routeOpts: {
        logLevel: "warn",
        schema: {
          tags: ["Health"],
          summary: "Runtime pressure metrics",
          description:
            "Reports process resource usage and aggregates under-pressure statistics for monitoring.",
        },
      },
    },
    healthCheck: async () => {
      await stat(config.sandboxRoot);
      return { sandboxRoot: config.sandboxRoot };
    },
  });

  fastify.register(fastifyHelmet, { contentSecurityPolicy: false });

  fastify.register(fastifyCors, {
    credentials: true,
    origin(origin, cb) {
      if (!origin) {
        cb(null, true);
        return;
      }
      if (config.allowAllOrigins || config.allowedOrigins.includes(origin)) {
        cb(null, true);
        return;
      }
      logger.warn("cors.origin_denied", { origin, reason: "origin-not-allowed" });
      cb(new Error("CORS origin denied"), false);
    },
  });

  fastify.addHook("onRequest", (request, _reply, done) => {
    createRequestContext(request, logger);
    done();
  });

  fastify.addHook("onResponse", (request, reply, done) => {
    if (request.appContext && !request.appContext.completed) {
      completeRequest(request, logger, reply.statusCode);
    }
    done();
  });

  fastify.setNotFoundHandler((request, reply) => {
    reply.code(404).headers({ "Content-Type": "application/json" }).send({ message: "Not Found" });
    completeRequest(request, logger, 404, { reason: "not-found" });
  });

  fastify.setErrorHandler((error, request, reply) => {
    const baseContext = request.appContext?.baseContext ?? {};
    if (error.code === "FST_ERR_BODY_TOO_LARGE") {
      reply.code(413).headers({ "Content-Type": "application/json" }).send({ message: "Payload too large" });
      logger.warn("request.body_invalid", {
        ...baseContext,
        statusCode: 413,
        error,
      });
      completeRequest(request, logger, 413, { route: "execute", reason: "invalid-body" });
      return;
    }
    if (error.code === "FST_ERR_CTP_INVALID_JSON") {
      reply.code(400).headers({ "Content-Type": "application/json" }).send({ message: "Invalid JSON payload" });
      logger.warn("request.body_invalid", {
        ...baseContext,
        statusCode: 400,
        error,
      });
      completeRequest(request, logger, 400, { route: "execute", reason: "invalid-body" });
      return;
    }

    logger.error("request.unhandled_exception", {
      ...baseContext,
      error,
    });

    reply.code(500).headers({ "Content-Type": "application/json" }).send({ message: "Internal Server Error" });
    completeRequest(request, logger, 500, { reason: "unhandled-exception" });
  });

  const healthRouteSchema = {
    tags: ["Health"],
    summary: "Health check",
    description: "Reports readiness for the terminal service.",
    response: {
      200: {
        description: "Service is healthy.",
        type: "object",
        additionalProperties: false,
        properties: {
          status: { type: "string", enum: ["ok"] },
        },
      },
    },
  };

  const infoRouteSchema = {
    tags: ["Terminal"],
    summary: "Terminal environment details",
    description: "Provides sandbox defaults, supported commands, and message of the day.",
    response: {
      200: {
        description: "Terminal info payload.",
        type: "object",
        additionalProperties: false,
        properties: {
          displayCwd: { type: "string" },
          virtualCwd: { type: "string" },
          supportedCommands: {
            type: "array",
            items: { type: "string" },
          },
          motd: {
            type: "array",
            items: { type: "string" },
          },
        },
      },
    },
  };

  const executionResponseSchema = {
    type: "object",
    additionalProperties: true,
    properties: {
      command: { type: ["string", "null"] },
      displayCwd: { type: "string" },
      cwd: { type: "string" },
      output: {
        type: "array",
        items: { type: "string" },
      },
      error: { type: "boolean" },
      clear: { type: "boolean" },
    },
  };

  const executionErrorSchema = {
    type: "object",
    additionalProperties: true,
    properties: {
      message: { type: "string" },
      error: { type: "boolean" },
      output: {
        type: "array",
        items: { type: "string" },
      },
    },
  };

  const executeRouteSchema = {
    tags: ["Terminal"],
    summary: "Execute a sandbox command",
    description: "Runs a whitelisted shell command within the sandbox environment.",
    body: {
      type: "object",
      additionalProperties: true,
      properties: {
        input: {
          type: "string",
          description: "Command string to execute.",
        },
        cwd: {
          type: "string",
          description: "Optional virtual working directory.",
        },
      },
    },
    response: {
      200: {
        description: "Command executed successfully.",
        ...executionResponseSchema,
      },
      400: {
        description: "The command was rejected or malformed.",
        ...executionErrorSchema,
      },
      422: {
        description: "Validation failed for command input.",
        ...executionErrorSchema,
      },
      500: {
        description: "Unexpected server error while executing command.",
        ...executionErrorSchema,
      },
    },
  };

  fastify.get("/healthz", { schema: healthRouteSchema }, async (request, reply) => {
    reply.send({ status: "ok" });
    completeRequest(request, logger, 200, { route: "healthz" });
  });

  fastify.get("/info", { schema: infoRouteSchema }, async (request, reply) => {
    const response = await handleInfo();
    reply
      .code(response.status)
      .headers({
        "Content-Type": "application/json",
      })
      .send(response.payload);
    completeRequest(request, logger, response.status, { route: "info" });
  });

  fastify.post("/execute", { schema: executeRouteSchema }, async (request, reply) => {
    const body = (request.body && typeof request.body === "object") ? request.body : {};
    const response = await handleExecute(body);
    reply
      .code(response.status)
      .headers({
        "Content-Type": "application/json",
      })
      .send(response.payload);
    completeRequest(request, logger, response.status, { route: "execute" });
  });

  return fastify;
}

