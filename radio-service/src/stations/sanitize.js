import { isIP } from "node:net";
import { config } from "../config/index.js";

const BLOCKED_HOSTNAMES = new Set(["localhost", "localhost.", "127.0.0.1", "::1"]);
const BLOCKED_HOSTNAME_SUFFIXES = [
  ".localhost",
  ".localhost.",
  ".local",
  ".localdomain",
  ".home",
  ".home.arpa",
  ".internal",
  ".intranet",
];

const IPV4_BLOCKED_RANGES = [
  ["0.0.0.0", "255.0.0.0"],
  ["10.0.0.0", "255.0.0.0"],
  ["100.64.0.0", "255.192.0.0"],
  ["127.0.0.0", "255.0.0.0"],
  ["169.254.0.0", "255.255.0.0"],
  ["172.16.0.0", "255.240.0.0"],
  ["192.0.0.0", "255.255.255.0"],
  ["192.0.2.0", "255.255.255.0"],
  ["192.168.0.0", "255.255.0.0"],
  ["198.18.0.0", "255.254.0.0"],
  ["198.51.100.0", "255.255.255.0"],
  ["203.0.113.0", "255.255.255.0"],
  ["224.0.0.0", "240.0.0.0"],
  ["240.0.0.0", "240.0.0.0"],
];

function toIpv4Int(address) {
  const parts = address.split(".");
  if (parts.length !== 4) {
    return null;
  }
  let value = 0;
  for (const part of parts) {
    const parsed = Number.parseInt(part, 10);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 255) {
      return null;
    }
    value = (value << 8) | parsed;
  }
  return value >>> 0;
}

const IPV4_BLOCKED_RANGES_INT = IPV4_BLOCKED_RANGES.map(([base, mask]) => ({
  base: toIpv4Int(base),
  mask: toIpv4Int(mask),
})).filter(({ base, mask }) => base !== null && mask !== null);

function isIpv4Blocked(address) {
  const intAddress = toIpv4Int(address);
  if (intAddress === null) {
    return false;
  }

  return IPV4_BLOCKED_RANGES_INT.some(({ base, mask }) => (intAddress & mask) === base);
}

function isIpv6Blocked(address) {
  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized === "::" || normalized === "[::1]") {
    return true;
  }

  const firstSegment = normalized.split(":")[0];
  if (/^(fc|fd)/.test(firstSegment)) {
    return true;
  }
  if (/^fe[89ab]/.test(firstSegment)) {
    return true;
  }
  if (/^ff/.test(firstSegment)) {
    return true;
  }

  if (normalized.includes("::ffff:")) {
    const mapped = normalized.split("::ffff:").pop();
    if (mapped && isIpv4Blocked(mapped.replace(/^\[/, "").replace(/\]$/, ""))) {
      return true;
    }
  }

  return false;
}

function hasSuspiciousHostname(hostname) {
  if (!hostname) {
    return true;
  }

  const normalized = hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(normalized)) {
    return true;
  }

  if (BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) {
    return true;
  }

  if (!normalized.includes(".") && isIP(hostname) === 0) {
    return true;
  }

  const ipVersion = isIP(hostname);
  if (ipVersion === 4) {
    return isIpv4Blocked(hostname);
  }
  if (ipVersion === 6) {
    return isIpv6Blocked(hostname);
  }

  return false;
}

export function normalizeList(value) {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function sanitizeUrl(
  rawUrl,
  { forceHttps = false, allowInsecure = false, blockPrivateHosts = false } = {},
) {
  if (!rawUrl) return null;
  const trimmed = rawUrl.toString().trim();
  if (trimmed.length === 0) return null;

  const normalizedInput = trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;

  try {
    const parsed = new URL(normalizedInput);
    if (blockPrivateHosts && hasSuspiciousHostname(parsed.hostname)) {
      return null;
    }
    if (parsed.protocol === "https:") {
      return parsed.toString();
    }

    if (parsed.protocol === "http:") {
      if (forceHttps || !allowInsecure) {
        parsed.protocol = "https:";
        if (blockPrivateHosts && hasSuspiciousHostname(parsed.hostname)) {
          return null;
        }
        return parsed.toString();
      }
      if (allowInsecure) {
        if (blockPrivateHosts && hasSuspiciousHostname(parsed.hostname)) {
          return null;
        }
        return parsed.toString();
      }
      return null;
    }

    if (!allowInsecure) {
      return null;
    }

    if (blockPrivateHosts && hasSuspiciousHostname(parsed.hostname)) {
      return null;
    }

    return parsed.toString();
  } catch (_error) {
    return null;
  }
}

export function sanitizeStreamUrl(rawUrl) {
  return sanitizeUrl(rawUrl, {
    forceHttps: true,
    allowInsecure: false,
    blockPrivateHosts: true,
  });
}

export function selectStreamUrl(data) {
  return sanitizeStreamUrl(data.url_resolved);
}

export function isBlockedDomain(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname.endsWith("stream.khz.se")) {
      return true;
    }
    return hasSuspiciousHostname(hostname);
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
