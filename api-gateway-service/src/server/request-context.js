import crypto from "node:crypto";

export function createRequestContextManager(logger) {
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

  return {
    createRequestContext,
    completeRequest,
  };
}

