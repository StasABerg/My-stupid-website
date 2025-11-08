import { loadStationsFromDatabase, persistStationsPayload } from "./storage.js";
import { sanitizePersistedStationsPayload } from "./normalize.js";
import { fetchFromRadioBrowser, notifyStationClick } from "./fetch.js";
import { SCHEMA_VERSION } from "./schemas.js";

export {
  SCHEMA_VERSION,
  sanitizePersistedStationsPayload,
  notifyStationClick,
  persistStationsPayload,
  loadStationsFromDatabase,
};

export async function getStationsFromStore() {
  return loadStationsFromDatabase();
}

export async function refreshStations(options = {}) {
  return fetchFromRadioBrowser(options);
}
