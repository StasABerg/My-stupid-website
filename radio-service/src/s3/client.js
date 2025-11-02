import { S3Client } from "@aws-sdk/client-s3";
import { SignatureV4 } from "@smithy/signature-v4";
import { createHash } from "node:crypto";
import { config } from "../config/index.js";

const credentials = {
  accessKeyId: config.s3.accessKeyId,
  secretAccessKey: config.s3.secretAccessKey,
};

class NodeSha256 {
  constructor() {
    this.hash = createHash("sha256");
  }

  update(data) {
    if (typeof data === "string") {
      this.hash.update(data, "utf8");
    } else {
      this.hash.update(data);
    }
  }

  async digest() {
    return this.hash.digest();
  }
}

function createSigner() {
  return new SignatureV4({
    credentials,
    region: config.s3.signingRegion ?? config.s3.region,
    service: config.s3.signingService ?? "s3",
    sha256: NodeSha256,
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
