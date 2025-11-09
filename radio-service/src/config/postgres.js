import { numberFromEnv } from "./env.js";

function isConnectionString(value) {
  return /^postgres(?:ql)?:\/\//i.test(value ?? "");
}

function encodeCredentials(user, password) {
  if (!user) {
    return "";
  }
  const encodedUser = encodeURIComponent(user);
  if (!password) {
    return `${encodedUser}@`;
  }
  return `${encodedUser}:${encodeURIComponent(password)}@`;
}

function normalizeHostTarget(rawUrl) {
  const trimmed = rawUrl?.trim() ?? "";
  if (!trimmed) {
    return null;
  }

  if (trimmed.includes("://")) {
    return trimmed;
  }

  const slashIndex = trimmed.indexOf("/");
  if (slashIndex === -1) {
    return null;
  }

  const hostPart = trimmed.slice(0, slashIndex);
  const databasePart = trimmed.slice(slashIndex + 1);
  if (!hostPart || !databasePart) {
    return null;
  }

  return { hostPart, databasePart };
}

function buildConnectionString(rawUrl, { user, password }) {
  if (!rawUrl) {
    return null;
  }

  if (isConnectionString(rawUrl)) {
    return rawUrl.trim();
  }

  const normalized = normalizeHostTarget(rawUrl);
  if (!normalized) {
    return null;
  }

  const credentials = encodeCredentials(user, password);
  return `postgresql://${credentials}${normalized.hostPart}/${normalized.databasePart}`;
}

function resolveSslOption(env) {
  const mode = (env.PG_SSL_MODE ?? "").trim().toLowerCase();
  if (!mode || mode === "prefer") {
    return undefined;
  }
  if (mode === "disable") {
    return false;
  }
  if (mode === "require" || mode === "verify-full") {
    const rejectUnauthorized = env.PG_SSL_REJECT_UNAUTHORIZED !== "false";
    return { rejectUnauthorized };
  }
  return undefined;
}

export function buildPostgresConfig(env) {
  const user = env.PG_USER ?? "";
  const password = env.PG_PASS ?? env.PG_PASSWORD ?? "";
  const connectionString = buildConnectionString(env.PG_URL, { user, password });

  return {
    connectionString,
    maxConnections: Math.max(numberFromEnv(env.PG_MAX_CONNECTIONS, 10), 1),
    statementTimeoutMs: Math.max(numberFromEnv(env.PG_STATEMENT_TIMEOUT_MS, 30000), 0),
    ssl: resolveSslOption(env),
    applicationName: env.PG_APP_NAME ?? "radio-service",
  };
}

export function validatePostgresConfig(config) {
  if (!config.connectionString) {
    throw new Error(
      "PG_URL must be provided. Use full postgres:// URL or host:port/database format.",
    );
  }

  let parsed;
  try {
    parsed = new URL(config.connectionString);
  } catch (error) {
    throw new Error(`Invalid PG_URL provided: ${error.message}`);
  }

  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("PG_URL must start with postgres:// or postgresql://");
  }

  if (!parsed.pathname || parsed.pathname.length <= 1) {
    throw new Error("PG_URL must include a database name (e.g. /appdb).");
  }
}
