export function shouldTreatAsPlaylist(streamUrl, contentType) {
  if (contentType) {
    const lowerType = contentType.toLowerCase();
    if (lowerType.includes("application/vnd.apple.mpegurl") || lowerType.includes("application/x-mpegurl")) {
      return true;
    }
  }
  try {
    const parsed = new URL(streamUrl);
    return /\.m3u8($|\?)/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function rewritePlaylist(streamUrl, playlist, { extraParams } = {}) {
  const baseUrl = new URL(streamUrl);
  const lines = playlist.split(/\r?\n/);
  const proxiedLines = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      return line;
    }
    try {
      const absolute = new URL(trimmed, baseUrl).toString();
      const searchParams = new URLSearchParams({ source: absolute });
      if (extraParams && typeof extraParams === "object") {
        for (const [key, value] of Object.entries(extraParams)) {
          if (typeof value === "string" && value.length > 0) {
            searchParams.append(key, value);
          }
        }
      }
      return `stream/segment?${searchParams.toString()}`;
    } catch (_error) {
      return line;
    }
  });
  return proxiedLines.join("\n");
}

export function pickForwardHeaders(req, allowList) {
  const headers = {};
  for (const name of allowList) {
    const value = req.headers[name.toLowerCase()];
    if (typeof value === "string" && value.trim().length > 0) {
      headers[name] = value;
    } else if (Array.isArray(value) && value.length > 0) {
      headers[name] = value.join(", ");
    }
  }
  return headers;
}
