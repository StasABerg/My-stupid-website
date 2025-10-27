const SERVICE_NAME = "api-gateway-service";

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

function emit(level, event, context = {}) {
  const payload = {
    timestamp: new Date().toISOString(),
    service: SERVICE_NAME,
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
