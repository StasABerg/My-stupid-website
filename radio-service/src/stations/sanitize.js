import { config } from "../config/index.js";

export function normalizeList(value) {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function sanitizeUrl(rawUrl, { forceHttps = false, allowInsecure = false } = {}) {
  if (!rawUrl) return null;
  const trimmed = rawUrl.toString().trim();
  if (trimmed.length === 0) return null;

  const normalizedInput = trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;

  try {
    const parsed = new URL(normalizedInput);
    if (parsed.protocol === "https:") {
      return parsed.toString();
    }

    if (parsed.protocol === "http:") {
      if (forceHttps || !allowInsecure) {
        parsed.protocol = "https:";
        return parsed.toString();
      }
      if (allowInsecure) {
        return parsed.toString();
      }
      return null;
    }

    return allowInsecure ? parsed.toString() : null;
  } catch (_error) {
    return null;
  }
}

export function sanitizeStreamUrl(rawUrl) {
  return sanitizeUrl(rawUrl, {
    forceHttps: true,
    allowInsecure: false,
  });
}

export function selectStreamUrl(data) {
  return sanitizeStreamUrl(data.url_resolved);
}

export function isBlockedDomain(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname.endsWith("stream.khz.se");
  } catch (_error) {
    return false;
  }
}

export function sanitizeStationUrl(url) {
  return sanitizeUrl(url, {
    forceHttps: config.radioBrowser.enforceHttpsStreams,
    allowInsecure: config.allowInsecureTransports,
  });
}
