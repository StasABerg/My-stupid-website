type LogLevel = "debug" | "info" | "warn" | "error";

const SERVICE = "app";
const ENVIRONMENT =
  (import.meta.env.VITE_APP_ENV as string | undefined) ??
  import.meta.env.MODE ??
  "development";
const HOST =
  typeof window !== "undefined" && window.location
    ? window.location.host
    : "unknown";

const LEVELS: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const MIN_LEVEL: number =
  LEVELS[
    ((import.meta.env.VITE_LOG_LEVEL as string | undefined) ??
      (ENVIRONMENT === "development" ? "debug" : "info")
    ).toLowerCase() as LogLevel
  ] ?? LEVELS.info;

function shouldLog(level: LogLevel) {
  return LEVELS[level] <= MIN_LEVEL;
}

function serialize(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      message: value.message,
      name: value.name,
      stack: value.stack,
    };
  }
  if (Array.isArray(value)) {
    return value.map((entry) => serialize(entry));
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      result[key] = serialize(entry);
    }
    return result;
  }
  return value;
}

function emit(level: LogLevel, event: string, context: Record<string, unknown> = {}) {
  if (!shouldLog(level)) return;

  const payload = {
    timestamp: new Date().toISOString(),
    service: SERVICE,
    env: ENVIRONMENT,
    host: HOST,
    level,
    event,
    ...serialize(context),
  };
  const line = JSON.stringify(payload);

  switch (level) {
    case "error":
      console.error(line);
      break;
    case "warn":
      console.warn(line);
      break;
    case "info":
      console.info(line);
      break;
    default:
      console.debug(line);
  }
}

export const logger = {
  debug(event: string, context?: Record<string, unknown>) {
    emit("debug", event, context ?? {});
  },
  info(event: string, context?: Record<string, unknown>) {
    emit("info", event, context ?? {});
  },
  warn(event: string, context?: Record<string, unknown>) {
    emit("warn", event, context ?? {});
  },
  error(event: string, context?: Record<string, unknown>) {
    emit("error", event, context ?? {});
  },
};
