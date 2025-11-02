import { S3Client } from "@aws-sdk/client-s3";
import { SignatureV4 } from "@smithy/signature-v4";
import { Sha256 } from "@aws-crypto/sha256-js";
import { config } from "../config/index.js";
import { logger } from "../logger.js";

const credentials = {
  accessKeyId: config.s3.accessKeyId,
  secretAccessKey: config.s3.secretAccessKey,
};

const signer = new SignatureV4({
  credentials,
  region: config.s3.signingRegion ?? config.s3.region,
  service: config.s3.signingService ?? "garage",
  sha256: Sha256,
});

const s3Client = new S3Client({
  region: config.s3.region,
  endpoint: config.s3.endpoint,
  forcePathStyle: true,
  credentials,
  signer,
});

s3Client.middlewareStack.add(
  (next) => async (args) => {
    const request = args.request;
    if (request) {
      const headers =
        typeof request.headers === "object" && request.headers !== null
          ? { ...request.headers }
          : null;
      logger.info("s3.request.debug", {
        method: request.method ?? null,
        protocol: request.protocol ?? null,
        hostname: request.hostname ?? null,
        path: request.path ?? null,
        headers,
      });
    }
    try {
      const response = await next(args);
      return response;
    } catch (error) {
      logger.error("s3.request_failed", {
        error,
      });
      throw error;
    }
  },
  {
    step: "finalizeRequest",
    name: "logS3SignedRequest",
  },
);

export function getS3Client() {
  return s3Client;
}
