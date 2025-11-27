import path from "node:path";

function parseNumber(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function requirePositive(name, value) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be greater than zero`);
  }
  return value;
}

function parseList(value) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

const sandboxRoot = path.resolve(process.env.SANDBOX_ROOT ?? "/app/sandbox");
const allowedOrigins = parseList(process.env.CORS_ALLOW_ORIGIN);
const allowAllOriginsFlag = process.env.ALLOW_ALL_ORIGINS === "true";

export const config = {
  port: requirePositive("PORT", parseNumber(process.env.PORT, 8080)),
  sandboxRoot,
  maxPayloadBytes: requirePositive(
    "MAX_PAYLOAD_BYTES",
    parseNumber(process.env.MAX_PAYLOAD_BYTES, 2048),
  ),
  defaultVirtualHome: "/home/demo",
  helpText: [
    "Available commands:",
    "  help       Show this help",
    "  clear      Clear the terminal output",
    "  ls [path]  List directory contents (flags: -a, -l, -la, -lh, -lah)",
    "  pwd        Print the current directory",
    "  whoami     Show the simulated user",
    "  cat FILE   Display a file inside the sandbox",
    "  cd DIR     Change the current directory",
    "  history    History is tracked in your browser",
    "  echo TEXT  Print the provided text",
    "  motd       Display the message of the day",
    "",
    "Commands run inside an isolated sandbox with no network access.",
  ],
  motdVirtualPath: "/etc/motd",
  lsAllowedFlags: ["-a", "-l", "-la", "-al", "-lh", "-hl", "-lah", "-hal"],
  unameAllowedFlags: ["-a", "-s", "-r", "-m"],
  allowedOrigins,
  allowAllOrigins: allowAllOriginsFlag && allowedOrigins.includes("*"),
};

if (!config.allowAllOrigins && config.allowedOrigins.length === 0) {
  throw new Error(
    "CORS_ALLOW_ORIGIN must include at least one allowed origin (or set ALLOW_ALL_ORIGINS=true with \"*\")",
  );
}

if (!path.isAbsolute(config.sandboxRoot) || config.sandboxRoot === "/") {
  throw new Error(`SANDBOX_ROOT must be an absolute, non-root path; got ${config.sandboxRoot}`);
}
