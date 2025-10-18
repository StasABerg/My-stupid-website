import "dotenv/config";

function numberFromEnv(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  port: numberFromEnv(process.env.PORT, 4010),
  redisUrl: process.env.REDIS_URL ?? "redis://valkey.media.cluster.local:6379",
  cacheKey: process.env.STATIONS_CACHE_KEY ?? "radio:stations:all",
  cacheTtlSeconds: numberFromEnv(process.env.STATIONS_CACHE_TTL, 900),
  s3: {
    endpoint: process.env.MINIO_ENDPOINT ?? "http://minio.media.cluster.local:9000",
    region: process.env.MINIO_REGION ?? "us-east-1",
    accessKeyId:
      process.env.MINIO_ACCESS_KEY ?? process.env.AWS_ACCESS_KEY_ID ?? "",
    secretAccessKey:
      process.env.MINIO_SECRET_KEY ?? process.env.AWS_SECRET_ACCESS_KEY ?? "",
    bucket: process.env.MINIO_BUCKET ?? "station-artifacts",
    objectKey: process.env.STATIONS_OBJECT_KEY ?? "stations/latest.json",
  },
  radioBrowser: {
    baseUrl: process.env.RADIO_BROWSER_BASE_URL ?? "https://api.radio-browser.info",
    stationsPath: process.env.RADIO_BROWSER_STATIONS_PATH ?? "/json/stations",
    limit: numberFromEnv(process.env.RADIO_BROWSER_LIMIT, 500),
  },
};

export function validateConfig() {
  if (!config.s3.accessKeyId || !config.s3.secretAccessKey) {
    throw new Error(
      "MINIO_ACCESS_KEY and MINIO_SECRET_KEY (or AWS_* equivalents) must be set to reach the station artifacts bucket.",
    );
  }
  if (!config.s3.bucket) {
    throw new Error("MINIO_BUCKET must be specified so the service knows where to store stations.");
  }
}
