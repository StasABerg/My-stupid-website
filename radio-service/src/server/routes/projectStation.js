export function projectStationForClient(station) {
  return {
    id: station.id,
    name: station.name,
    streamUrl: station.streamUrl,
    homepage: station.homepage ?? null,
    favicon: station.favicon ?? null,
    country: station.country ?? null,
    countryCode: station.countryCode ?? null,
    state: station.state ?? null,
    languages: Array.isArray(station.languages) ? station.languages : [],
    tags: Array.isArray(station.tags) ? station.tags.slice(0, 12) : [],
    bitrate: station.bitrate ?? null,
    codec: station.codec ?? null,
    hls: Boolean(station.hls),
    isOnline: Boolean(station.isOnline),
    clickCount: station.clickCount ?? 0,
  };
}
