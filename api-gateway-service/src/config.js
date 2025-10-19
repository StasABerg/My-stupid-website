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

export const config = {
  port: parsePort(process.env.PORT, DEFAULT_PORT),
  radioServiceUrl: DEFAULT_RADIO_BASE_URL.replace(/\/$/, ""),
  terminalServiceUrl: DEFAULT_TERMINAL_BASE_URL.replace(/\/$/, ""),
  requestTimeoutMs: parsePort(process.env.UPSTREAM_TIMEOUT_MS, 10000),
  allowOrigins: (process.env.CORS_ALLOW_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
};
