import { PutObjectCommand } from "@aws-sdk/client-s3";
import { config } from "../config/index.js";
import { logger } from "../logger.js";
import { getS3Client } from "./client.js";

let lastPersistedFingerprint = null;

function parseMaxConcurrency(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function joinS3Key(prefix, suffix) {
  if (!prefix || prefix.length === 0) {
    return suffix;
  }
  const normalizedPrefix = prefix.replace(/\/+$/u, "");
  const normalizedSuffix = suffix.replace(/^\/+/, "");
  return `${normalizedPrefix}/${normalizedSuffix}`;
}

export async function writeStationsToS3(payload) {
  const stationsBody = JSON.stringify({
    stations: Array.isArray(payload.stations) ? payload.stations : [],
  });

  const metadataBody = JSON.stringify({
    schemaVersion: payload.schemaVersion ?? null,
    updatedAt: payload.updatedAt ?? null,
    source: payload.source ?? null,
    requests: Array.isArray(payload.requests) ? payload.requests : [],
    total:
      typeof payload.total === "number" && payload.total >= 0
        ? payload.total
        : Array.isArray(payload.stations)
          ? payload.stations.length
          : 0,
  });

  const client = getS3Client();
  const writes = [
    client.send(
      new PutObjectCommand({
        Bucket: config.s3.bucket,
        Key: config.s3.objectKey,
        Body: stationsBody,
        ContentType: "application/json",
      }),
    ),
  ];

  if (config.s3.metadataKey) {
    writes.push(
      client.send(
        new PutObjectCommand({
          Bucket: config.s3.bucket,
          Key: config.s3.metadataKey,
          Body: metadataBody,
          ContentType: "application/json",
        }),
      ),
    );
  }

  await Promise.all(writes);
}

export async function writeStationsByCountryToS3(_payload, countryGroups) {
  if (!config.s3.countryPrefix) {
    return;
  }

  const maxConcurrency = parseMaxConcurrency(process.env.S3_WRITE_CONCURRENCY, 5);
  const client = getS3Client();
  const inFlight = new Set();

  async function schedulePut(commandPromise) {
    inFlight.add(commandPromise);
    try {
      await commandPromise;
    } finally {
      inFlight.delete(commandPromise);
    }
  }

  for (const [slug, group] of countryGroups) {
    const key = joinS3Key(config.s3.countryPrefix, `${slug}.json`);
    const body = JSON.stringify({
      country: {
        name: group.name ?? null,
        code: group.code ?? null,
      },
      total: group.stations.length,
      stations: group.stations,
    });

    schedulePut(
      client.send(
        new PutObjectCommand({
          Bucket: config.s3.bucket,
          Key: key,
          Body: body,
          ContentType: "application/json",
        }),
      ),
    );

    if (inFlight.size >= maxConcurrency) {
      await Promise.race(inFlight);
    }
  }

  if (inFlight.size > 0) {
    await Promise.all(Array.from(inFlight));
  }
}

export function scheduleStationsPersistence(payload, countryGroups, options = {}) {
  const { fingerprint, changed = true } = options;
  const effectiveFingerprint = fingerprint ?? null;

  const shouldPersist =
    changed !== false ||
    (effectiveFingerprint && effectiveFingerprint !== lastPersistedFingerprint);

  if (!shouldPersist) {
    return;
  }

  Promise.all([
    writeStationsToS3(payload),
    writeStationsByCountryToS3(payload, countryGroups),
  ])
    .then(() => {
      if (effectiveFingerprint) {
        lastPersistedFingerprint = effectiveFingerprint;
      } else if (changed !== false) {
        lastPersistedFingerprint = JSON.stringify(payload?.stations ?? []);
      }
    })
    .catch((error) => {
      logger.error("stations.persistence_error", { error });
    });
}
