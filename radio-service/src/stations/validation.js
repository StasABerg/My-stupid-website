import { config } from "../config/index.js";
import { fetchWithKeepAlive, keepAliveAgent } from "../http/client.js";
import { loadValidationCache, writeValidationCache } from "../cache/streamValidationCache.js";
import { isBlockedDomain } from "./sanitize.js";
import { buildStationSignature } from "./normalize.js";

const VALIDATION_HEADERS = {
  Range: "bytes=0-4095",
  "User-Agent": "my-stupid-website gitgud.qzz.io stasberg",
  Accept: "*/*",
  "Accept-Encoding": "gzip, deflate, br",
  Connection: "keep-alive",
};

async function readHasData(body) {
  if (!body) {
    return false;
  }

  if (typeof body.getReader === "function") {
    const reader = body.getReader();
    try {
      const { value, done } = await reader.read();
      return Boolean(value && value.length > 0 && !done);
    } finally {
      try {
        await reader.cancel();
      } catch (_error) {
        /* ignore cancellation errors */
      }
    }
  }

  if (typeof body[Symbol.asyncIterator] === "function") {
    for await (const chunk of body) {
      if (chunk && chunk.length > 0) {
        return true;
      }
    }
  }

  return false;
}

export async function validateStationStream(station) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.streamValidation.timeoutMs);

  try {
    const clean = async (response) => {
      if (response?.body) {
        try {
          await response.body.cancel();
        } catch (_error) {
          /* ignore cancellation errors */
        }
      }
    };

    if (isBlockedDomain(station.streamUrl)) {
      return { ok: false, reason: "blocked-domain" };
    }

    let candidate;
    try {
      candidate = await fetchWithKeepAlive(station.streamUrl, {
        method: "GET",
        headers: VALIDATION_HEADERS,
        redirect: "follow",
        signal: controller.signal,
        dispatcher: keepAliveAgent,
      });
    } catch (error) {
      if (error.name === "AbortError") {
        throw error;
      }
      return { ok: false, reason: "network" };
    }

    if (!candidate.ok && candidate.status !== 206) {
      await clean(candidate);
      return { ok: false, reason: `status-${candidate.status}` };
    }

    const finalUrl = candidate.url ?? station.streamUrl;
    if (!finalUrl.toLowerCase().startsWith("https://")) {
      await clean(candidate);
      return { ok: false, reason: "insecure-redirect" };
    }

    if (isBlockedDomain(finalUrl)) {
      await clean(candidate);
      return { ok: false, reason: "blocked-domain" };
    }

    const contentType = candidate.headers.get("content-type") ?? "";

    const lowerType = contentType.toLowerCase().split(";")[0].trim();
    const isKnownStreamType =
      lowerType.startsWith("audio/") ||
      lowerType.startsWith("video/") ||
      lowerType.includes("mpegurl") ||
      lowerType === "application/octet-stream" ||
      lowerType === "application/x-mpegurl";

    const hasData = await readHasData(candidate.body);
    await clean(candidate);

    if (!isKnownStreamType) {
      return { ok: false, reason: "unexpected-content-type" };
    }
    if (!hasData) {
      return { ok: false, reason: "empty-response" };
    }

    return {
      ok: true,
      finalUrl,
      contentType,
    };
  } catch (error) {
    if (error.name === "AbortError") {
      return { ok: false, reason: "timeout" };
    }
    return { ok: false, reason: "network" };
  } finally {
    clearTimeout(timeout);
  }
}

export async function validateStationStreams(stations, { redis } = {}) {
  const concurrency = Math.max(1, config.streamValidation.concurrency);
  const accepted = new Array(stations.length);
  const dropCounts = new Map();
  const cacheKey = config.streamValidation.cacheKey;

  const cache = await loadValidationCache(redis, cacheKey);

  const cacheUpdates = new Map();
  const cacheRemovals = new Set();
  const runtimeResults = new Map();

  const recordDrop = (reason) => {
    const key = reason ?? "invalid";
    dropCounts.set(key, (dropCounts.get(key) ?? 0) + 1);
  };

  let index = 0;

  const workers = Array.from({ length: concurrency }, async () => {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const currentIndex = index;
      index += 1;
      if (currentIndex >= stations.length) {
        break;
      }

      const station = stations[currentIndex];
      const runtimeKey =
        typeof station.streamUrl === "string" ? station.streamUrl : "";
      const signature = buildStationSignature(station);
      const cacheEntry = cache?.get(station.streamUrl);
      const now = Date.now();

      if (cacheEntry && typeof cacheEntry.validatedAt === "number") {
        const entryTtlSeconds =
          typeof cacheEntry.ttlSeconds === "number" && cacheEntry.ttlSeconds > 0
            ? cacheEntry.ttlSeconds
            : config.streamValidation.cacheTtlSeconds;
        const entryTtlMs = entryTtlSeconds * 1000;
        const isFresh = now - cacheEntry.validatedAt <= entryTtlMs;
        const signatureMatches = cacheEntry.signature === signature;
        const cachedUrl = cacheEntry.finalUrl ?? station.streamUrl;
        const isSecure = typeof cachedUrl === "string" && cachedUrl.toLowerCase().startsWith("https://");

        if (isFresh && signatureMatches) {
          if (cacheEntry.ok === false) {
            recordDrop(cacheEntry.reason);
            continue;
          }

          if (isSecure) {
            const updatedStation = { ...station };
            if (cacheEntry.finalUrl && cacheEntry.finalUrl !== station.streamUrl) {
              updatedStation.streamUrl = cacheEntry.finalUrl;
            }
            if (cacheEntry.forceHls === true && !updatedStation.hls) {
              updatedStation.hls = true;
            }
            accepted[currentIndex] = updatedStation;
            continue;
          }
        }

        if (redis && cacheKey) {
          cacheRemovals.add(station.streamUrl);
        }
      }

      let runtimePromise = runtimeResults.get(runtimeKey);
      if (!runtimePromise) {
        runtimePromise = (async () => {
          const result = await validateStationStream(station);
          if (result.ok) {
            const validationTime = Date.now();
            const forceHls = Boolean(result.contentType && /mpegurl/i.test(result.contentType));
            const finalUrl = result.finalUrl && result.finalUrl !== station.streamUrl
              ? result.finalUrl
              : station.streamUrl;

            return {
              ok: true,
              finalUrl,
              forceHls,
              cacheValue: {
                ok: true,
                validatedAt: validationTime,
                finalUrl,
                forceHls,
                signature,
                ttlSeconds: config.streamValidation.cacheTtlSeconds,
              },
            };
          }

          const reason = result.reason ?? "invalid";
          const validationTime = Date.now();
          return {
            ok: false,
            reason,
            cacheValue: {
              ok: false,
              reason,
              validatedAt: validationTime,
              signature,
              ttlSeconds: config.streamValidation.failureCacheTtlSeconds,
            },
          };
        })();
        runtimeResults.set(runtimeKey, runtimePromise);
      }

      const outcome = await runtimePromise;

      if (outcome.ok) {
        const updatedStation = { ...station };
        if (outcome.finalUrl && outcome.finalUrl !== station.streamUrl) {
          updatedStation.streamUrl = outcome.finalUrl;
        }
        if (outcome.forceHls && !updatedStation.hls) {
          updatedStation.hls = true;
        }
        accepted[currentIndex] = updatedStation;
      } else {
        recordDrop(outcome.reason);
      }

      if (redis && cacheKey) {
        if (outcome.cacheValue) {
          cacheUpdates.set(station.streamUrl, outcome.cacheValue);
          cacheRemovals.delete(station.streamUrl);
        } else if (!cacheUpdates.has(station.streamUrl)) {
          cacheRemovals.add(station.streamUrl);
        }
      }
    }
  });

  await Promise.all(workers);

  const filtered = accepted.filter(Boolean);
  const updates =
    cacheUpdates.size > 0
      ? Array.from(cacheUpdates.entries()).map(([streamUrl, value]) => ({ streamUrl, value }))
      : [];

  await writeValidationCache({
    redis,
    cacheKey,
    updates,
    removals: cacheRemovals,
    ttlSeconds: config.streamValidation.cacheTtlSeconds,
  });

  return {
    stations: filtered,
    dropped: stations.length - filtered.length,
    reasons: Object.fromEntries(dropCounts),
  };
}
