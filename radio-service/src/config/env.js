export function numberFromEnv(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function booleanFromEnv(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

export function trustProxyFromEnv(value) {
  if (value === undefined || value === null) {
    return true;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return true;
  }
  const lower = trimmed.toLowerCase();
  if (lower === "true") return true;
  if (lower === "false") return false;
  const asNumber = Number.parseInt(trimmed, 10);
  if (Number.isFinite(asNumber) && String(asNumber) === trimmed) {
    return asNumber;
  }
  if (trimmed.includes(",")) {
    const parts = trimmed
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    return parts.length > 0 ? parts : true;
  }
  return trimmed;
}

export function deriveMetadataKey(objectKey) {
  if (!objectKey) {
    return null;
  }
  const trimmed = objectKey.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.toLowerCase().endsWith(".json")) {
    return `${trimmed.slice(0, -5)}-metadata.json`;
  }
  return `${trimmed}-metadata.json`;
}

export function deriveTrustProxyValue(rawValue) {
  const baseValue = trustProxyFromEnv(rawValue);
  const clusterCidr = "10.42.0.0/16";

  if (baseValue === false) {
    return [clusterCidr];
  }

  if (baseValue === true) {
    return true;
  }

  if (typeof baseValue === "number") {
    return [baseValue, clusterCidr];
  }

  if (typeof baseValue === "string") {
    const parsed = baseValue
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    parsed.push(clusterCidr);
    return parsed;
  }

  if (Array.isArray(baseValue)) {
    return [...baseValue, clusterCidr];
  }

  return [clusterCidr];
}
