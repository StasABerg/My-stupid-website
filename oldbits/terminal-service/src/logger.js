import os from "node:os";

const SERVICE_NAME = "terminal-service";
const ENVIRONMENT =
  process.env.APP_ENV || process.env.NODE_ENV || "development";
const HOST = os.hostname?.() || process.env.HOSTNAME || "unknown";

const LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const MIN_LEVEL =
  LEVELS[(process.env.LOG_LEVEL || "info").toLowerCase()] ?? LEVELS.info;

function serialize(value) {
  if (value instanceof Error) {
    return {
      message: value.message,
      name: value.name,
      stack: value.stack,
    };
  }
  if (Array.isArray(value)) {
    return value.map((item) => serialize(item));
  }
  if (value && typeof value === "object") {
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      result[key] = serialize(entry);
    }
    return result;
  }
  return value;
}

function shouldLog(level) {
  const numeric = LEVELS[level] ?? LEVELS.info;
  return numeric <= MIN_LEVEL;
}

function emit(level, event, context = {}) {
  if (!shouldLog(level)) {
    return;
  }

  const payload = {
    timestamp: new Date().toISOString(),
    service: SERVICE_NAME,
    env: ENVIRONMENT,
    host: HOST,
    level,
    event,
    ...serialize(context),
  };

  const message = JSON.stringify(payload);

  if (level === "error") {
    console.error(message);
    return;
  }

  if (level === "warn") {
    console.warn(message);
    return;
  }

  console.log(message);
}

export const logger = {
  debug(event, context) {
    emit("debug", event, context);
  },
  info(event, context) {
    emit("info", event, context);
  },
  warn(event, context) {
    emit("warn", event, context);
  },
  error(event, context) {
    emit("error", event, context);
  },
};
