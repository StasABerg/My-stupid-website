import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { config } from "./config.js";

function parseMaxConcurrency(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const s3Client = new S3Client({
  region: config.s3.region,
  endpoint: config.s3.endpoint,
  forcePathStyle: true,
  credentials: {
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey,
  },
});

async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

async function fetchJsonObject(key) {
  if (!key) {
    return null;
  }
  try {
    const response = await s3Client.send(
      new GetObjectCommand({
        Bucket: config.s3.bucket,
        Key: key,
      }),
    );
    const body = await streamToString(response.Body);
    return JSON.parse(body);
  } catch (error) {
    if (error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404) {
      return null;
    }
    throw error;
  }
}

export async function fetchStationsFromS3() {
  const [stationsObject, metadataObject] = await Promise.all([
    fetchJsonObject(config.s3.objectKey),
    fetchJsonObject(config.s3.metadataKey),
  ]);

  if (!stationsObject || typeof stationsObject !== "object") {
    throw new Error("Stations payload missing or invalid in S3.");
  }

  let stations = [];
  if (Array.isArray(stationsObject)) {
    stations = stationsObject;
  } else if (Array.isArray(stationsObject.stations)) {
    stations = stationsObject.stations;
  } else {
    stations = [];
  }

  let embeddedMetadata = null;
  if (stationsObject && typeof stationsObject === "object" && !Array.isArray(stationsObject)) {
    const maybeMetadataFields = ["schemaVersion", "updatedAt", "source", "requests", "total"];
    const hasMetadata = maybeMetadataFields.some((field) => field in stationsObject);
    if (hasMetadata) {
      embeddedMetadata = {
        schemaVersion: stationsObject.schemaVersion ?? null,
        updatedAt: stationsObject.updatedAt ?? null,
        source: stationsObject.source ?? null,
        requests: stationsObject.requests ?? null,
        total: stationsObject.total ?? null,
      };
    }
  }

  const metadata = metadataObject ?? embeddedMetadata ?? {};

  const totalCandidate =
    typeof metadata.total === "number"
      ? metadata.total
      : Number.parseInt(metadata.total ?? "", 10);
  const total = Number.isFinite(totalCandidate) && totalCandidate >= 0 ? totalCandidate : stations.length;

  const requestsArray = Array.isArray(metadata.requests) ? metadata.requests : [];

  return {
    schemaVersion: metadata.schemaVersion ?? null,
    updatedAt: metadata.updatedAt ?? null,
    source: metadata.source ?? null,
    requests: requestsArray,
    total,
    stations,
  };
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

  const writes = [
    s3Client.send(
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
      s3Client.send(
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
      s3Client.send(
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

export function scheduleStationsPersistence(payload, countryGroups) {
  Promise.all([
    writeStationsToS3(payload),
    writeStationsByCountryToS3(payload, countryGroups),
  ]).catch((error) => {
    console.error("stations-persistence-error", { message: error.message });
  });
}
