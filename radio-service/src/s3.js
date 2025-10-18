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

export async function writeStationsToS3(payload) {
  const command = new PutObjectCommand({
    Bucket: config.s3.bucket,
    Key: config.s3.objectKey,
    Body: JSON.stringify(payload),
    ContentType: "application/json",
  });

  await s3Client.send(command);
}
