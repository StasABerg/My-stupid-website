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

export function rewritePlaylist(streamUrl, playlist) {
  const baseUrl = new URL(streamUrl);
  const lines = playlist.split(/\r?\n/);
  const proxiedLines = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      return line;
    }
    try {
      const absolute = new URL(trimmed, baseUrl).toString();
      const encoded = encodeURIComponent(absolute);
      return `stream/segment?source=${encoded}`;
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
