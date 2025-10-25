import { Worker } from "node:worker_threads";
import { computeStationsMetadata } from "./processing.js";
import { ensureNormalizedStation } from "./normalize.js";

const PROCESSED_PAYLOAD_KEY = Symbol.for("radio.stations.processed");
const WORKER_URL = new URL("./processedWorker.js", import.meta.url);

let jobCounter = 0;

function createWorkerJob(stations) {
  if (!Array.isArray(stations) || stations.length === 0) {
    return Promise.resolve({
      countries: [],
      genres: [],
      byCountry: Object.create(null),
      byLanguage: Object.create(null),
      byTag: Object.create(null),
      searchTexts: [],
    });
  }

  const jobId = (jobCounter += 1);

  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_URL, { type: "module" });
    const teardown = () => {
      worker.terminate().catch(() => {});
    };

    worker.once("message", (message) => {
      if (!message || message.id !== jobId) {
        return;
      }

      teardown();

      if (message.type === "error") {
        reject(new Error(message.error?.message ?? "Stations metadata worker failed."));
        return;
      }

      if (message.type === "result") {
        resolve(message.metadata);
        return;
      }

      reject(new Error("Unexpected response from stations metadata worker."));
    });

    worker.once("error", (error) => {
      teardown();
      reject(error);
    });

    worker.postMessage({
      type: "process",
      id: jobId,
      stations,
    });
  });
}

function recordToStationMap(record, stations) {
  const map = new Map();
  if (!record || typeof record !== "object") {
    return map;
  }

  for (const [key, indexes] of Object.entries(record)) {
    if (!Array.isArray(indexes) || indexes.length === 0) {
      continue;
    }
    const resolvedStations = [];
    for (const index of indexes) {
      const station = stations[index];
      if (station) {
        resolvedStations.push(station);
      }
    }
    if (resolvedStations.length > 0) {
      map.set(key, resolvedStations);
    }
  }

  return map;
}

function hydrateMetadata(stations, metadata) {
  const stationIndex = new Map();
  stations.forEach((station, index) => {
    stationIndex.set(station, index);
  });

  return {
    stations,
    countries: Array.isArray(metadata?.countries) ? metadata.countries : [],
    genres: Array.isArray(metadata?.genres) ? metadata.genres : [],
    searchTexts: Array.isArray(metadata?.searchTexts) ? metadata.searchTexts : [],
    stationIndex,
    index: {
      byCountry: recordToStationMap(metadata?.byCountry, stations),
      byLanguage: recordToStationMap(metadata?.byLanguage, stations),
      byTag: recordToStationMap(metadata?.byTag, stations),
    },
  };
}

async function buildProcessedStations(payload) {
  const stations = Array.isArray(payload?.stations) ? payload.stations : [];
  stations.forEach((station) => {
    ensureNormalizedStation(station);
  });

  try {
    const metadata = await createWorkerJob(stations);
    return hydrateMetadata(stations, metadata);
  } catch (error) {
    const metadata = computeStationsMetadata(stations);
    return hydrateMetadata(stations, metadata);
  }
}

export async function ensureProcessedStations(payload) {
  if (!payload || typeof payload !== "object") {
    return hydrateMetadata([], null);
  }

  const existing = payload[PROCESSED_PAYLOAD_KEY];
  if (existing && existing.ready && existing.data) {
    return existing.data;
  }
  if (existing && existing.promise) {
    return existing.promise;
  }

  const state = {
    ready: false,
    data: null,
    promise: null,
  };

  Object.defineProperty(payload, PROCESSED_PAYLOAD_KEY, {
    value: state,
    enumerable: false,
    configurable: false,
    writable: false,
  });

  state.promise = buildProcessedStations(payload).then((data) => {
    state.ready = true;
    state.data = data;
    state.promise = null;
    return data;
  });

  return state.promise;
}
