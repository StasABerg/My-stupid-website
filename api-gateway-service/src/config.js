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

export const config = {
  port: parsePort(process.env.PORT, DEFAULT_PORT),
  radioServiceUrl,
  terminalServiceUrl,
  requestTimeoutMs: parsePort(process.env.UPSTREAM_TIMEOUT_MS, 10000),
  allowOrigins: splitList(process.env.CORS_ALLOW_ORIGINS),
  allowedServiceHostnames,
};
