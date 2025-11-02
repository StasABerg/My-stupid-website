import { S3Client } from "@aws-sdk/client-s3";
import { config } from "../config/index.js";

const s3Client = new S3Client({
  region: config.s3.region,
  endpoint: config.s3.endpoint,
  forcePathStyle: true,
  credentials: {
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey,
  },
  signingRegion: config.s3.signingRegion,
  signingService: config.s3.signingService,
});

export function getS3Client() {
  return s3Client;
}
