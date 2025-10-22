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
  const cacheTtlMs = config.streamValidation.cacheTtlSeconds * 1000;
  const now = Date.now();

  const cache = await loadValidationCache(redis, cacheKey);

  const cacheUpdates = [];
  const cacheRemovals = new Set();

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
      const signature = buildStationSignature(station);
      const cacheEntry = cache?.get(station.streamUrl);
      if (cacheEntry && typeof cacheEntry.validatedAt === "number") {
        const isFresh = now - cacheEntry.validatedAt <= cacheTtlMs;
        const signatureMatches = cacheEntry.signature === signature;
        const cachedUrl = cacheEntry.finalUrl ?? station.streamUrl;
        const isSecure = cachedUrl.toLowerCase().startsWith("https://");
        if (isFresh && signatureMatches && isSecure) {
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
        if (redis && cacheKey) {
          cacheRemovals.add(station.streamUrl);
        }
      }

      const result = await validateStationStream(station);
      if (result.ok) {
        const updatedStation = { ...station };
        if (result.finalUrl && result.finalUrl !== station.streamUrl) {
          updatedStation.streamUrl = result.finalUrl;
        }
        if (result.contentType && /mpegurl/i.test(result.contentType) && !station.hls) {
          updatedStation.hls = true;
        }
        accepted[currentIndex] = updatedStation;
        if (redis && cacheKey) {
          cacheUpdates.push({
            streamUrl: station.streamUrl,
            value: {
              validatedAt: Date.now(),
              finalUrl: updatedStation.streamUrl,
              forceHls: updatedStation.hls === true,
              signature,
            },
          });
        }
      } else {
        const reason = result.reason ?? "invalid";
        dropCounts.set(reason, (dropCounts.get(reason) ?? 0) + 1);
        if (redis && cacheKey) {
          cacheRemovals.add(station.streamUrl);
        }
      }
    }
  });

  await Promise.all(workers);

  const filtered = accepted.filter(Boolean);
  await writeValidationCache({
    redis,
    cacheKey,
    updates: cacheUpdates,
    removals: cacheRemovals,
    ttlSeconds: config.streamValidation.cacheTtlSeconds,
  });

  return {
    stations: filtered,
    dropped: stations.length - filtered.length,
    reasons: Object.fromEntries(dropCounts),
  };
}
