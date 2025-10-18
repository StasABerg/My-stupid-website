import dns from "node:dns/promises";
import { config } from "./config.js";

const RADIO_BROWSER_SRV_RECORD = "_api._tcp.radio-browser.info";

let cachedBaseUrl;
let resolvingPromise;

function pickRandomHost(hosts) {
  if (!Array.isArray(hosts) || hosts.length === 0) {
    return null;
  }

  const sortedHosts = hosts
    .filter((host) => typeof host?.name === "string" && host.name.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  if (sortedHosts.length === 0) {
    return null;
  }

  const index = Math.floor(Math.random() * sortedHosts.length);
  return sortedHosts[index];
}

async function resolveBaseUrl() {
  if (cachedBaseUrl) {
    return cachedBaseUrl;
  }

  if (resolvingPromise) {
    return resolvingPromise;
  }

  resolvingPromise = (async () => {
    try {
      const hosts = await dns.resolveSrv(RADIO_BROWSER_SRV_RECORD);
      const randomHost = pickRandomHost(hosts);
      if (randomHost?.name) {
        cachedBaseUrl = `https://${randomHost.name}`;
        return cachedBaseUrl;
      }
    } catch (error) {
      console.warn("radio-browser-srv-resolution-failed", { message: error.message });
    }

    cachedBaseUrl = config.radioBrowser.defaultBaseUrl;
    return cachedBaseUrl;
  })();

  try {
    return await resolvingPromise;
  } finally {
    resolvingPromise = null;
  }
}

export async function getRadioBrowserBaseUrl() {
  return resolveBaseUrl();
}

export async function buildRadioBrowserUrl(pathname) {
  const baseUrl = await resolveBaseUrl();
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return new URL(normalizedPath, baseUrl);
}
