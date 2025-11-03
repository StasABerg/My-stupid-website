export function createCorsHelpers(config) {
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

  return {
    buildCorsHeaders,
    isOriginAllowed,
    handlePreflight,
  };
}

