import { GetObjectCommand } from "@aws-sdk/client-s3";
import { config } from "../config/index.js";
import { getS3Client } from "./client.js";

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
    const response = await getS3Client().send(
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
