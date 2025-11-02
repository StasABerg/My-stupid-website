import { S3Client } from "@aws-sdk/client-s3";
import { SignatureV4 } from "@smithy/signature-v4";
import { config } from "../config/index.js";

const credentials = {
  accessKeyId: config.s3.accessKeyId,
  secretAccessKey: config.s3.secretAccessKey,
};

function createSigner() {
  return new SignatureV4({
    credentials,
    region: config.s3.signingRegion ?? config.s3.region,
    service: config.s3.signingService ?? "s3",
  });
}

const s3Client = new S3Client({
  region: config.s3.region,
  endpoint: config.s3.endpoint,
  forcePathStyle: true,
  credentials,
  signer: createSigner(),
});

export function getS3Client() {
  return s3Client;
}
