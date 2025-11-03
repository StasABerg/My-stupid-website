import { deriveMetadataKey } from "./env.js";

export function buildS3Config(env) {
  const rawRegion = env.MINIO_SIGNING_REGION?.trim();
  const signingRegion =
    rawRegion && rawRegion.length > 0 ? rawRegion : env.MINIO_REGION;
  const rawService = env.MINIO_REGION?.trim();
  const signingService =
    rawService && rawService.length > 0 ? rawService : "garage";

  return {
    endpoint: env.MINIO_ENDPOINT,
    region: env.MINIO_REGION,
    signingRegion,
    signingService,
    accessKeyId: env.MINIO_ACCESS_KEY ?? env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.MINIO_SECRET_KEY ?? env.AWS_SECRET_ACCESS_KEY,
    bucket: env.MINIO_BUCKET,
    objectKey: env.STATIONS_OBJECT_KEY,
    metadataKey:
      env.STATIONS_METADATA_OBJECT_KEY ?? deriveMetadataKey(env.STATIONS_OBJECT_KEY),
    countryPrefix: env.STATIONS_BY_COUNTRY_PREFIX ?? "stations/by-country",
  };
}

export function validateS3Config(config, allowInsecureTransports) {
  if (!config.accessKeyId || !config.secretAccessKey) {
    throw new Error(
      "MINIO_ACCESS_KEY and MINIO_SECRET_KEY (or AWS_* equivalents) must be set to reach the station artifacts bucket.",
    );
  }
  if (!config.bucket) {
    throw new Error("MINIO_BUCKET must be specified so the service knows where to store stations.");
  }
  if (!config.endpoint) {
    throw new Error("MINIO_ENDPOINT must be provided so the service can reach the object store.");
  }
  if (!config.metadataKey) {
    throw new Error(
      "STATIONS_METADATA_OBJECT_KEY (or a derivable value) must be set so station metadata can be stored separately.",
    );
  }

  if (!config.signingService) {
    throw new Error("MINIO_REGION must be provided when using custom S3-compatible endpoints.");
  }

  let s3Endpoint;
  try {
    s3Endpoint = new URL(config.endpoint);
  } catch (error) {
    throw new Error(`Invalid MINIO_ENDPOINT provided: ${error.message}`);
  }

  if (s3Endpoint.protocol !== "https:" && allowInsecureTransports !== true) {
    throw new Error(
      "MINIO_ENDPOINT must use HTTPS. Set ALLOW_INSECURE_TRANSPORT=true to bypass in trusted environments.",
    );
  }
}
