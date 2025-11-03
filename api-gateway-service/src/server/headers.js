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

export function sanitizeRequestHeaders(headers) {
  const result = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!value) continue;
    const lowerKey = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lowerKey)) continue;
    result[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  return result;
}

export function sanitizeResponseHeaders(headers) {
  const result = {};
  headers.forEach((value, key) => {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) return;
    result[key] = value;
  });
  return result;
}

export function sanitizeHeadersForCache(headers) {
  const filtered = { ...headers };
  for (const key of Object.keys(filtered)) {
    const lower = key.toLowerCase();
    if (lower === "set-cookie" || lower === "set-cookie2" || lower === "content-length") {
      delete filtered[key];
    }
  }
  return filtered;
}

export function findHeaderKey(headers, target) {
  const lowerTarget = target.toLowerCase();
  return Object.keys(headers).find((key) => key.toLowerCase() === lowerTarget) ?? null;
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

export function appendForwardedFor(headers, remoteAddress) {
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

export function resolveClientIp(req) {
  const headerCandidates = ["cf-connecting-ip", "cf-connection-ip"];
  for (const header of headerCandidates) {
    const raw = req.headers[header];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value === "string" && value.trim().length > 0) {
      const normalized = normalizeAddress(value.trim());
      if (normalized) {
        return { ip: normalized, source: header };
      }
    }
  }

  const rawForwarded = req.headers["x-forwarded-for"];
  const forwardedValue = Array.isArray(rawForwarded) ? rawForwarded[0] : rawForwarded;
  if (forwardedValue && forwardedValue.trim().length > 0) {
    const first = forwardedValue.split(",")[0].trim();
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

