import http from "node:http";
import { config } from "./config.js";

const ALLOWED_SERVICE_HOSTNAMES = new Set(config.allowedServiceHostnames);
const RADIO_PREFIX = "/radio";
const TERMINAL_PREFIX = "/terminal";

const VALID_PREFIXES = [RADIO_PREFIX, TERMINAL_PREFIX];

function log(message, details = {}) {
  const payload = {
    ts: new Date().toISOString(),
    msg: message,
    ...details,
  };
  console.log(JSON.stringify(payload));
}

function buildCorsHeaders(origin) {
  if (!origin) return { Vary: "Origin" };

  const allowed = config.allowOrigins;
  const wildcard = allowed.includes("*");
  if (allowed.length === 0 || wildcard || allowed.includes(origin)) {
    const headers = {
      Vary: "Origin",
      "Access-Control-Allow-Origin": wildcard ? "*" : origin,
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,PATCH,OPTIONS",
      "Access-Control-Allow-Headers": "authorization,content-type",
    };

    if (!wildcard) {
      headers["Access-Control-Allow-Credentials"] = "true";
    }

    return headers;
  }

  return { Vary: "Origin" };
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

function sanitizePath(prefix, rawSuffix) {
  if (!VALID_PREFIXES.includes(prefix)) {
    return null;
  }
  // Only allow single leading slash, prohibit path traversal, encoded traversal, backslashes, double slashes
  let suffix = rawSuffix || "/";
  if (!suffix.startsWith("/")) suffix = "/" + suffix;
  // Prohibit path traversal attempts even if encoded
  const decoded = decodeUntilStable(suffix);
  if (containsTraversal(suffix) || containsTraversal(decoded)) {
    log("blocked-ssrf-attempt", { prefix, suffix });
    return null;
  }
  // Optionally normalize: collapse multiple slashes
  suffix = suffix.replace(/\/{2,}/g, "/");
  return suffix;
}

function determineTarget(pathname) {
  if (pathname === RADIO_PREFIX || pathname.startsWith(`${RADIO_PREFIX}/`)) {
    const rawSuffix = pathname.slice(RADIO_PREFIX.length) || "/";
    const sanitized = sanitizePath(RADIO_PREFIX, rawSuffix);
    if (!sanitized) return null;
    return {
      baseUrl: config.radioServiceUrl,
      path: sanitized,
    };
  }

  if (pathname === TERMINAL_PREFIX || pathname.startsWith(`${TERMINAL_PREFIX}/`)) {
    const rawSuffix = pathname.slice(TERMINAL_PREFIX.length) || "/";
    const sanitized = sanitizePath(TERMINAL_PREFIX, rawSuffix);
    if (!sanitized) return null;
    return {
      baseUrl: config.terminalServiceUrl,
      path: sanitized,
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

if (ALLOWED_SERVICE_HOSTNAMES.size === 0) {
  console.error("api-gateway-service: No allowed service hostnames configured; refusing to start.");
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
  console.error(`api-gateway-service configuration error: ${error.message}`);
  process.exit(1);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => {
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve(null);
      } else {
        resolve(Buffer.concat(chunks));
      }
    });
    req.on("error", reject);
  });
}

async function proxyRequest(req, res, target) {
  const parsed = new URL(req.url ?? "/", "http://localhost");
  const targetUrl = new URL(target.path + parsed.search, `${target.baseUrl}`);
  const allowedHostname = new URL(target.baseUrl).hostname;
  if (
    (targetUrl.protocol !== "https:" && targetUrl.protocol !== "http:") ||
    targetUrl.hostname !== allowedHostname
  ) {
    throw new Error("Resolved target URL failed host validation.");
  }

  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), config.requestTimeoutMs);

  try {
    const body =
      req.method === "GET" || req.method === "HEAD" ? null : await readRequestBody(req);

    const outgoingHeaders = sanitizeRequestHeaders(req.headers);
    const clientIp = deriveClientIp(req);
    if (clientIp) {
      const cfKey = findHeaderKey(outgoingHeaders, "cf-connecting-ip");
      if (cfKey) {
        outgoingHeaders[cfKey] = clientIp;
      } else {
        outgoingHeaders["CF-Connecting-IP"] = clientIp;
      }
      outgoingHeaders["X-Real-IP"] = clientIp;
    }
    appendForwardedFor(outgoingHeaders, req.socket?.remoteAddress ?? null);

    const upstreamResponse = await fetch(targetUrl, {
      method: req.method,
      headers: outgoingHeaders,
      body,
      signal: abort.signal,
    });

    const corsHeaders = buildCorsHeaders(req.headers.origin);
    const headers = sanitizeResponseHeaders(upstreamResponse.headers);

    res.writeHead(upstreamResponse.status, {
      ...headers,
      ...corsHeaders,
    });

    if (upstreamResponse.body) {
      for await (const chunk of upstreamResponse.body) {
        res.write(chunk);
      }
    }
    res.end();
  } catch (error) {
    const corsHeaders = buildCorsHeaders(req.headers.origin);
    const status = error.name === "AbortError" ? 504 : 502;
    log("proxy-error", { status, error: error.message, target: target.baseUrl });
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
  } finally {
    clearTimeout(timeout);
  }
}

function deriveClientIp(req) {
  const cf = req.headers["cf-connecting-ip"];
  if (typeof cf === "string" && cf.trim().length > 0) {
    return normalizeAddress(cf.trim());
  }
  if (Array.isArray(cf) && cf.length > 0) {
    return normalizeAddress(cf[0].trim());
  }

  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim().length > 0) {
    return normalizeAddress(forwarded.split(",")[0].trim());
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return normalizeAddress(forwarded[0].split(",")[0].trim());
  }

  return normalizeAddress(req.socket?.remoteAddress ?? null);
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

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing request URL" }));
    return;
  }

  const url = new URL(req.url, "http://localhost");

  if (req.method === "OPTIONS") {
    handlePreflight(req, res);
    return;
  }

  if (url.pathname === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  const target = determineTarget(url.pathname);
  if (!target) {
    const corsHeaders = buildCorsHeaders(req.headers.origin);
    res.writeHead(404, {
      "Content-Type": "application/json",
      ...corsHeaders,
    });
    res.end(JSON.stringify({ error: "Not Found" }));
    return;
  }

  await proxyRequest(req, res, target);
});

server.listen(config.port, () => {
  log("api-gateway-started", {
    port: config.port,
    radioServiceUrl: config.radioServiceUrl,
    terminalServiceUrl: config.terminalServiceUrl,
  });
});

const shutdown = () => {
  server.close(() => {
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
