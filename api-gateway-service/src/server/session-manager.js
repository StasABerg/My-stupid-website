import fastifySession from "@fastify/session";
import Redis from "ioredis";
import crypto from "node:crypto";

class RedisSessionStore extends fastifySession.Store {
  constructor(client, { keyPrefix, ttlSeconds }) {
    super();
    this.client = client;
    this.keyPrefix = keyPrefix;
    this.ttlSeconds = Math.max(ttlSeconds, 1);
  }

  buildKey(sessionId) {
    return `${this.keyPrefix}${sessionId}`;
  }

  async get(sessionId, callback) {
    try {
      const raw = await this.client.get(this.buildKey(sessionId));
      if (!raw) {
        callback?.(null, null);
        return null;
      }
      const value = JSON.parse(raw);
      callback?.(null, value);
      return value;
    } catch (error) {
      callback?.(error);
      return null;
    }
  }

  async set(sessionId, session, callback) {
    try {
      const payload = JSON.stringify(session);
      await this.client.set(this.buildKey(sessionId), payload, "EX", this.ttlSeconds);
      callback?.(null);
    } catch (error) {
      callback?.(error);
    }
  }

  async destroy(sessionId, callback) {
    try {
      await this.client.del(this.buildKey(sessionId));
      callback?.(null);
    } catch (error) {
      callback?.(error);
    }
  }

  async touch(sessionId, session, callback) {
    try {
      const payload = JSON.stringify(session);
      await this.client.set(this.buildKey(sessionId), payload, "EX", this.ttlSeconds);
      callback?.(null);
    } catch (error) {
      callback?.(error);
    }
  }
}

function generateSessionNonce() {
  return crypto.randomBytes(16).toString("hex");
}

const CSRF_PROOF_VERSION = 1;

function encodeProofPayload(nonce, expiresAt) {
  const expiresSegment =
    Number.isFinite(expiresAt) && expiresAt > 0 ? Math.floor(expiresAt).toString(36) : "0";
  return { payload: `${nonce}:${expiresSegment}`, expiresSegment };
}

function buildCsrfProof(secret, nonce, expiresAt) {
  if (!secret || !nonce) {
    return null;
  }
  const { payload, expiresSegment } = encodeProofPayload(nonce, expiresAt);
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `v${CSRF_PROOF_VERSION}.${expiresSegment}.${nonce}.${signature}`;
}

function verifyCsrfProof(secret, proof) {
  if (typeof proof !== "string") {
    return null;
  }
  const parts = proof.split(".");
  if (parts.length !== 4) {
    return null;
  }
  const [version, expiresSegment, nonce, signature] = parts;
  if (version !== `v${CSRF_PROOF_VERSION}` || !nonce || !signature || !expiresSegment) {
    return null;
  }
  const expiresAt = Number.parseInt(expiresSegment, 36);
  if (!Number.isFinite(expiresAt)) {
    return null;
  }
  const { payload } = encodeProofPayload(nonce, expiresAt);
  let expected;
  try {
    expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  } catch {
    return null;
  }
  let expectedBuffer;
  let providedBuffer;
  try {
    expectedBuffer = Buffer.from(expected, "hex");
    providedBuffer = Buffer.from(signature, "hex");
  } catch {
    return null;
  }
  if (
    expectedBuffer.length !== providedBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    return null;
  }
  return {
    nonce,
    expiresAt,
  };
}

function buildCsrfSessionKey(prefix, token) {
  return `${prefix}${token}`;
}

function ensureSessionObject(session) {
  if (!session || typeof session !== "object") {
    return {};
  }
  return session;
}

function extractHeaderValue(headers, target) {
  const lowerTarget = target.toLowerCase();
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === lowerTarget);
  if (!entry) return null;
  const [, raw] = entry;
  if (Array.isArray(raw)) {
    return raw.length > 0 ? raw[0] : null;
  }
  return typeof raw === "string" ? raw : null;
}

async function persistFastifySession(session) {
  if (!session || typeof session.save !== "function") {
    return;
  }
  await new Promise((resolve, reject) => {
    session.save((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export async function createSessionManager(config, logger) {
  const SESSION_MAX_AGE_MS = config.session.maxAgeMs;
  const SESSION_TTL_SECONDS = Math.floor(SESSION_MAX_AGE_MS / 1000);

  let sessionSecret = config.session.secret;
  let sessionRedisClient = null;
  let sessionStore = null;

  if (config.session.store?.redis?.enabled && config.session.store.redis.url) {
    const redisOptions = {
      maxRetriesPerRequest: 2,
      connectTimeout: config.session.store.redis.connectTimeoutMs,
    };

    if (
      config.session.store.redis.url.startsWith("rediss://") &&
      config.session.store.redis.tlsRejectUnauthorized === false
    ) {
      redisOptions.tls = {
        rejectUnauthorized: false,
      };
    }

    sessionRedisClient = new Redis(config.session.store.redis.url, redisOptions);
    sessionRedisClient.on("error", (error) => {
      logger.error("session.redis_error", { error });
    });

    sessionStore = new RedisSessionStore(sessionRedisClient, {
      keyPrefix: config.session.store.redis.keyPrefix,
      ttlSeconds: SESSION_TTL_SECONDS,
    });
  } else {
    logger.warn("session.store.memory_mode", {
      reason: "redis-disabled",
      message:
        "Gateway session data is using the in-memory store; configure SESSION_REDIS_URL for shared deployments.",
    });
  }

  if (config.session.secretGenerated && sessionRedisClient && config.session.store?.redis?.keyPrefix) {
    const secretKey = `${config.session.store.redis.keyPrefix}__secret`;
    try {
      await sessionRedisClient.setnx(secretKey, sessionSecret);
      const sharedSecret = await sessionRedisClient.get(secretKey);
      if (sharedSecret && sharedSecret.length >= 32) {
        if (sharedSecret !== sessionSecret) {
          logger.info("session.secret_synchronized", { source: "redis" });
        }
        sessionSecret = sharedSecret;
        config.session.secret = sharedSecret;
      }
    } catch (error) {
      logger.warn("session.secret_sync_failed", { error });
    }
  }

  const csrfKeyPrefix =
    config.session.store?.redis?.keyPrefix !== undefined
      ? `${config.session.store.redis.keyPrefix}nonce:`
      : "gateway:session:nonce:";

  const inMemoryCsrfSessions = new Map();

  async function storeCsrfSessionRecord(token, sessionData) {
    if (!token) return;

    const record = {
      nonce: sessionData?.nonce ?? null,
      expiresAt: sessionData?.expiresAt ?? null,
      csrfProof:
        typeof sessionData?.csrfProof === "string" && sessionData.csrfProof.length > 0
          ? sessionData.csrfProof
          : buildCsrfProof(sessionSecret, sessionData?.nonce ?? null, sessionData?.expiresAt ?? null),
    };

    if (sessionRedisClient) {
      try {
        await sessionRedisClient.set(
          buildCsrfSessionKey(csrfKeyPrefix, token),
          JSON.stringify(record),
          "EX",
          SESSION_TTL_SECONDS,
        );
      } catch (error) {
        logger.warn("session.csrf_store_failed", { error });
      }
      return;
    }

    inMemoryCsrfSessions.set(token, record);
  }

  async function loadCsrfSessionRecord(token) {
    if (!token) return null;

    if (sessionRedisClient) {
      try {
        const raw = await sessionRedisClient.get(buildCsrfSessionKey(csrfKeyPrefix, token));
        if (!raw) {
          return null;
        }
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") {
          return null;
        }
        if (
          (!parsed.csrfProof || typeof parsed.csrfProof !== "string" || parsed.csrfProof.length === 0) &&
          parsed.nonce &&
          parsed.expiresAt
        ) {
          parsed.csrfProof = buildCsrfProof(sessionSecret, parsed.nonce, parsed.expiresAt);
        }
        return parsed;
      } catch (error) {
        logger.warn("session.csrf_lookup_failed", { error });
        return null;
      }
    }

    const record = inMemoryCsrfSessions.get(token);
    if (!record) {
      return null;
    }
    if (record.expiresAt && Date.now() > record.expiresAt) {
      inMemoryCsrfSessions.delete(token);
      return null;
    }
    if (
      (!record.csrfProof || typeof record.csrfProof !== "string" || record.csrfProof.length === 0) &&
      record.nonce &&
      record.expiresAt
    ) {
      record.csrfProof = buildCsrfProof(sessionSecret, record.nonce, record.expiresAt);
    }
    return record;
  }

  async function deleteCsrfSessionRecord(token) {
    if (!token) return;

    if (sessionRedisClient) {
      try {
        await sessionRedisClient.del(buildCsrfSessionKey(csrfKeyPrefix, token));
      } catch (error) {
        logger.warn("session.csrf_delete_failed", { error });
      }
      return;
    }

    inMemoryCsrfSessions.delete(token);
  }

  function initializeSession(session) {
    const target = ensureSessionObject(session);
    const issuedAt = Date.now();
    const nonce = generateSessionNonce();
    target.nonce = nonce;
    target.csrfToken = nonce;
    target.issuedAt = issuedAt;
    target.expiresAt = issuedAt + SESSION_MAX_AGE_MS;
    target.csrfProof = buildCsrfProof(sessionSecret, nonce, target.expiresAt);
    return {
      nonce,
      expiresAt: target.expiresAt,
      csrfProof: target.csrfProof,
    };
  }

  function refreshSession(session) {
    const target = ensureSessionObject(session);
    const refreshedAt = Date.now();
    target.expiresAt = refreshedAt + SESSION_MAX_AGE_MS;
    if (typeof target.nonce === "string" && target.nonce.length > 0) {
      target.csrfProof = buildCsrfProof(sessionSecret, target.nonce, target.expiresAt);
    }
    return target.expiresAt;
  }

  async function persistSession(session) {
    await persistFastifySession(session);
  }

  async function validateSession(request, parsedUrl) {
    const session = ensureSessionObject(request.session);
    request.session = session;

    const csrfProofHeader = extractHeaderValue(request.headers, "x-gateway-csrf-proof");
    let csrfProof =
      typeof csrfProofHeader === "string" && csrfProofHeader.trim().length > 0
        ? csrfProofHeader.trim()
        : null;
    const csrfHeader = extractHeaderValue(request.headers, "x-gateway-csrf");
    let csrfToken =
      typeof csrfHeader === "string" && csrfHeader.trim().length > 0 ? csrfHeader.trim() : null;
    if (!csrfToken && parsedUrl) {
      const param = parsedUrl.searchParams.get("csrfToken");
      if (typeof param === "string" && param.trim().length > 0) {
        csrfToken = param.trim();
      }
    }
    if (!csrfProof && parsedUrl) {
      const param = parsedUrl.searchParams.get("csrfProof");
      if (typeof param === "string" && param.trim().length > 0) {
        csrfProof = param.trim();
      }
    }

    if (typeof session.nonce !== "string" && csrfProof) {
      const verified = verifyCsrfProof(sessionSecret, csrfProof);
      if (verified) {
        if (Date.now() > verified.expiresAt) {
          await deleteCsrfSessionRecord(verified.nonce);
        } else {
          session.nonce = verified.nonce;
          session.expiresAt = verified.expiresAt;
          session.issuedAt = Math.max(0, verified.expiresAt - SESSION_MAX_AGE_MS);
          session.csrfProof = csrfProof;
          if (!csrfToken) {
            csrfToken = verified.nonce;
          } else if (csrfToken !== verified.nonce) {
            return { ok: false, statusCode: 403, error: "Missing or invalid CSRF token" };
          }
        }
      } else {
        logger.warn("session.csrf_proof_invalid", {
          proofLength: csrfProof.length,
        });
      }
    }

    if (typeof session.nonce !== "string" && csrfToken) {
      const csrfRecord = await loadCsrfSessionRecord(csrfToken);
      if (csrfRecord && csrfRecord.nonce && csrfRecord.expiresAt) {
        if (Date.now() > csrfRecord.expiresAt) {
          await deleteCsrfSessionRecord(csrfToken);
        } else {
          session.nonce = csrfRecord.nonce;
          session.expiresAt = csrfRecord.expiresAt;
          session.issuedAt = csrfRecord.issuedAt ?? Date.now();
          session.csrfProof =
            typeof csrfRecord.csrfProof === "string" && csrfRecord.csrfProof.length > 0
              ? csrfRecord.csrfProof
              : buildCsrfProof(sessionSecret, session.nonce, session.expiresAt);
          if (!csrfProof && session.csrfProof) {
            csrfProof = session.csrfProof;
          }
        }
      }
    }

    if (typeof session.nonce !== "string") {
      return { ok: false, statusCode: 401, error: "Session required" };
    }

    const expiresAtValue = Number.parseInt(session.expiresAt ?? "", 10);
    if (!Number.isFinite(expiresAtValue)) {
      return { ok: false, statusCode: 401, error: "Invalid session" };
    }

    if (Date.now() > expiresAtValue) {
      await deleteCsrfSessionRecord(session.nonce);
      return { ok: false, statusCode: 401, error: "Session expired" };
    }

    const method = (request.raw.method ?? "").toUpperCase();
    const csrfRequired = method !== "OPTIONS";
    if (csrfRequired) {
      if (!csrfToken || csrfToken !== session.nonce) {
        return { ok: false, statusCode: 403, error: "Missing or invalid CSRF token" };
      }
    }

    refreshSession(session);
    if (typeof session.touch === "function") {
      try {
        session.touch();
      } catch (error) {
        logger.warn("session.touch_failed", { error });
      }
    }

    try {
      await persistSession(session);
    } catch (error) {
      logger.warn("session.persist_during_validation_failed", { error });
    }

    await storeCsrfSessionRecord(session.nonce, {
      nonce: session.nonce,
      expiresAt: session.expiresAt,
      csrfProof:
        typeof session.csrfProof === "string" && session.csrfProof.length > 0
          ? session.csrfProof
          : buildCsrfProof(sessionSecret, session.nonce, session.expiresAt),
    });

    return {
      ok: true,
      session: {
        nonce: session.nonce,
        expiresAt: session.expiresAt,
        csrfProof: session.csrfProof ?? null,
      },
    };
  }

  async function recordIssuedSession(sessionInfo) {
    await storeCsrfSessionRecord(sessionInfo.nonce, {
      nonce: sessionInfo.nonce,
      expiresAt: sessionInfo.expiresAt,
      csrfProof: sessionInfo.csrfProof ?? null,
    });
  }

  async function shutdown() {
    if (sessionRedisClient) {
      try {
        await sessionRedisClient.quit();
        logger.info("session.redis_connection_closed", {});
      } catch (error) {
        logger.warn("session.redis_quit_failed", { error });
        sessionRedisClient.disconnect();
      }
    }
  }

  return {
    sessionSecret,
    sessionStore,
    sessionRedisClient,
    initializeSession,
    persistSession,
    validateSession,
    recordIssuedSession,
    extractHeaderValue,
    shutdown,
  };
}
