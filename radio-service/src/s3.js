import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { config } from "./config.js";

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

export async function fetchStationsFromS3() {
  const command = new GetObjectCommand({
    Bucket: config.s3.bucket,
    Key: config.s3.objectKey,
  });

  const response = await s3Client.send(command);
  const body = await streamToString(response.Body);
  return JSON.parse(body);
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
  const command = new PutObjectCommand({
    Bucket: config.s3.bucket,
    Key: config.s3.objectKey,
    Body: JSON.stringify(payload),
    ContentType: "application/json",
  });

  await s3Client.send(command);
}

export async function writeStationsByCountryToS3(payload, countryGroups) {
  if (!config.s3.countryPrefix) {
    return;
  }

  const baseMetadata = {
    updatedAt: payload.updatedAt,
    source: payload.source,
    requests: payload.requests,
  };

  const putCommands = [];
  for (const [slug, group] of countryGroups) {
    const key = joinS3Key(config.s3.countryPrefix, `${slug}.json`);
    const body = JSON.stringify({
      ...baseMetadata,
      country: {
        name: group.name ?? null,
        code: group.code ?? null,
      },
      total: group.stations.length,
      stations: group.stations,
    });

    putCommands.push(
      s3Client.send(
        new PutObjectCommand({
          Bucket: config.s3.bucket,
          Key: key,
          Body: body,
          ContentType: "application/json",
        }),
      ),
    );
  }

  await Promise.all(putCommands);
}
