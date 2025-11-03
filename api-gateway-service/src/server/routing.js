const ABSOLUTE_URL_PATTERN = /^[a-z][a-z0-9+.-]*:/i;
const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/;

function decodeUntilStable(value) {
  let current = value;
  for (let i = 0; i < 3; i += 1) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) {
        return current;
      }
      current = decoded;
    } catch {
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

export function createRoutingHelpers({ config, logger, radioPrefix, terminalPrefix }) {
  const VALID_PREFIXES = [radioPrefix, terminalPrefix];
  const allowedHostnames = new Set(config.allowedServiceHostnames);

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
    let suffix = rawSuffix || "/";
    if (!suffix.startsWith("/")) suffix = `/${suffix}`;
    const decoded = decodeUntilStable(suffix);
    if (containsTraversal(suffix) || containsTraversal(decoded)) {
      logger.warn("request.blocked_ssrf_attempt", {
        ...context,
        prefix,
        suffix,
      });
      return null;
    }
    return suffix.replace(/\/{2,}/g, "/");
  }

  function determineTarget(pathname, context = {}) {
    if (pathname === radioPrefix || pathname.startsWith(`${radioPrefix}/`)) {
      const rawSuffix = pathname.slice(radioPrefix.length) || "/";
      const sanitized = sanitizePath(radioPrefix, rawSuffix, context);
      if (!sanitized) return null;
      return {
        baseUrl: config.radioServiceUrl,
        path: sanitized,
        service: "radio",
      };
    }

    if (pathname === terminalPrefix || pathname.startsWith(`${terminalPrefix}/`)) {
      const rawSuffix = pathname.slice(terminalPrefix.length) || "/";
      const sanitized = sanitizePath(terminalPrefix, rawSuffix, context);
      if (!sanitized) return null;
      return {
        baseUrl: config.terminalServiceUrl,
        path: sanitized,
        service: "terminal",
      };
    }

    return null;
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

  function validateBaseUrl(serviceName, serviceUrl) {
    let parsed;
    try {
      parsed = new URL(serviceUrl);
    } catch (error) {
      throw new Error(`Invalid ${serviceName}: ${serviceUrl}`);
    }
    if (!allowedHostnames.has(parsed.hostname)) {
      throw new Error(
        `Blocked SSRF risk for ${serviceName}: hostname "${parsed.hostname}" is not allowed. Allowed: ${Array.from(
          allowedHostnames,
        ).join(", ")}`,
      );
    }
    return parsed;
  }

  function validateBaseUrls() {
    validateBaseUrl("radioServiceUrl", config.radioServiceUrl);
    validateBaseUrl("terminalServiceUrl", config.terminalServiceUrl);
  }

  return {
    parseRequestUrl,
    determineTarget,
    shouldCacheRequest,
    buildCacheKey,
    validateBaseUrls,
  };
}

