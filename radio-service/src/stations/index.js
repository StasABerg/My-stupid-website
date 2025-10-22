import { fetchStationsFromS3, scheduleStationsPersistence } from "../s3/index.js";
import { sanitizePersistedStationsPayload } from "./normalize.js";
import { fetchFromRadioBrowser, notifyStationClick } from "./fetch.js";
import { SCHEMA_VERSION } from "./schemas.js";

export {
  SCHEMA_VERSION,
  sanitizePersistedStationsPayload,
  notifyStationClick,
  scheduleStationsPersistence,
};

export async function getStationsFromS3() {
  return fetchStationsFromS3();
}

export async function refreshStations(options = {}) {
  return fetchFromRadioBrowser(options);
}
