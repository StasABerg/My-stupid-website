import { Readable } from "node:stream";

function buildProxyRequestBody(request, signal) {
  const req = request.raw;
  if (req.method === "GET" || req.method === "HEAD") {
    return null;
  }

  const contentType = typeof req.headers["content-type"] === "string" ? req.headers["content-type"] : "";
  if (request.body !== undefined && request.body !== null) {
    if (Buffer.isBuffer(request.body) || request.body instanceof Uint8Array) {
      return request.body;
    }
    if (typeof request.body === "string") {
      return request.body;
    }
    if (contentType.startsWith("application/json")) {
      return JSON.stringify(request.body);
    }
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

export function createProxyHandler({
  config,
  cache,
  logger,
  helpers,
}) {
  const {
    sanitizeRequestHeaders,
    sanitizeResponseHeaders,
    sanitizeHeadersForCache,
    resolveClientIp,
    appendForwardedFor,
    findHeaderKey,
  } = helpers;

  async function proxyRequest(request, res, target, session, corsHeaders, cacheOptions, parsedUrl, requestContext) {
    const req = request.raw;
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
      const body = buildProxyRequestBody(request, abort.signal);

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

      let bufferedChunks = null;
      if (cacheable) {
        bufferedChunks = [];
      }

      const responseHeaders = {
        ...headers,
        ...corsHeaders,
      };

      if (!responseHeaders["content-type"]) {
        responseHeaders["Content-Type"] = upstreamResponse.headers.get("content-type") ?? "application/json";
      }

      if (session?.nonce) {
        responseHeaders["X-Gateway-Session"] = session.nonce;
      }

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

  return {
    proxyRequest,
  };
}
