import http from "node:http";
import { config } from "./config.js";

const RADIO_PREFIX = "/radio";
const TERMINAL_PREFIX = "/terminal";

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
  if (allowed.length === 0 || allowed.includes("*") || allowed.includes(origin)) {
    return {
      Vary: "Origin",
      "Access-Control-Allow-Origin": allowed.includes("*") ? "*" : origin,
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,PATCH,OPTIONS",
      "Access-Control-Allow-Headers": "authorization,content-type",
      "Access-Control-Allow-Credentials": "true",
    };
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

function determineTarget(pathname) {
  if (pathname === RADIO_PREFIX || pathname.startsWith(`${RADIO_PREFIX}/`)) {
    const suffix = pathname.slice(RADIO_PREFIX.length) || "/";
    return {
      baseUrl: config.radioServiceUrl,
      path: suffix.startsWith("/") ? suffix : `/${suffix}`,
    };
  }

  if (pathname === TERMINAL_PREFIX || pathname.startsWith(`${TERMINAL_PREFIX}/`)) {
    const suffix = pathname.slice(TERMINAL_PREFIX.length) || "/";
    return {
      baseUrl: config.terminalServiceUrl,
      path: suffix.startsWith("/") ? suffix : `/${suffix}`,
    };
  }

  return null;
}

function sanitizeHeaders(headers) {
  const result = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!value) continue;
    const lowerKey = key.toLowerCase();
    if (lowerKey === "host" || lowerKey === "content-length") continue;
    result[key] = value;
  }
  return result;
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

  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), config.requestTimeoutMs);

  try {
    const body =
      req.method === "GET" || req.method === "HEAD" ? null : await readRequestBody(req);

    const upstreamResponse = await fetch(targetUrl, {
      method: req.method,
      headers: sanitizeHeaders(req.headers),
      body,
      signal: abort.signal,
    });

    const corsHeaders = buildCorsHeaders(req.headers.origin);
    const headers = {};
    upstreamResponse.headers.forEach((value, key) => {
      headers[key] = value;
    });

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
    res.writeHead(status, {
      "Content-Type": "application/json",
      ...corsHeaders,
    });
    res.end(JSON.stringify({ error: "Upstream request failed" }));
  } finally {
    clearTimeout(timeout);
  }
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
