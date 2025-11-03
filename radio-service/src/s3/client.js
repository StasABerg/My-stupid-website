import { S3Client } from "@aws-sdk/client-s3";
import { config } from "../config/index.js";
import { logger } from "../logger.js";

const s3Client = new S3Client({
  region: config.s3.region,
  endpoint: config.s3.endpoint,
  forcePathStyle: true,
  credentials: {
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey,
  },
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
