import crypto from "node:crypto";

const DEFAULT_PORT = 8080;
const DEFAULT_RADIO_BASE_URL =
  process.env.RADIO_SERVICE_URL ??
  "http://my-stupid-website-radio.my-stupid-website.svc.cluster.local:4010";
const DEFAULT_TERMINAL_BASE_URL =
  process.env.TERMINAL_SERVICE_URL ??
  "http://my-stupid-website-terminal.my-stupid-website.svc.cluster.local:80";

function parsePort(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function splitList(value) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function extractHostname(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

const radioServiceUrl = DEFAULT_RADIO_BASE_URL.replace(/\/$/, "");
const terminalServiceUrl = DEFAULT_TERMINAL_BASE_URL.replace(/\/$/, "");
const explicitAllowedHosts = splitList(process.env.ALLOWED_SERVICE_HOSTNAMES);
const derivedHosts = [extractHostname(radioServiceUrl), extractHostname(terminalServiceUrl)].filter(
  (value) => value !== null,
);
const allowedServiceHostnames = Array.from(
  new Set([...derivedHosts, ...explicitAllowedHosts]),
);

function deriveSessionSecret(rawSecret) {
  const value = rawSecret?.trim();
  if (value && value.length >= 32) {
    return value;
  }

  const generated = crypto.randomBytes(32).toString("hex");
  console.warn(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "warn",
      msg: "SESSION_SECRET not provided or too short; using ephemeral key",
    }),
  );
  return generated;
}

function parseDurationSeconds(value, fallbackSeconds) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackSeconds;
}

export const config = {
  port: parsePort(process.env.PORT, DEFAULT_PORT),
  radioServiceUrl,
  terminalServiceUrl,
  requestTimeoutMs: parsePort(process.env.UPSTREAM_TIMEOUT_MS, 10000),
  allowOrigins: splitList(process.env.CORS_ALLOW_ORIGINS),
  allowedServiceHostnames,
  session: {
    cookieName: process.env.SESSION_COOKIE_NAME?.trim() || "gateway.sid",
    secret: deriveSessionSecret(process.env.SESSION_SECRET),
    maxAgeMs: parseDurationSeconds(process.env.SESSION_MAX_AGE_SECONDS, 60 * 60 * 12) * 1000,
  },
};
