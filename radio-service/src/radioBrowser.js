import dns from "node:dns/promises";
import { config } from "./config.js";

const RADIO_BROWSER_SRV_RECORD = "_api._tcp.radio-browser.info";

let resolvingPromise;
let hostPool;
let cachedBaseUrl;
let hostIndex = 0;

function buildBaseUrl(hostname) {
  if (typeof hostname !== "string" || hostname.trim().length === 0) {
    return null;
  }
  return `https://${hostname.trim()}`;
}

function dedupe(values) {
  return values.filter((value, index) => values.indexOf(value) === index);
}

async function resolveHostPool() {
  if (hostPool && hostPool.length > 0) {
    return hostPool;
  }

  if (resolvingPromise) {
    return resolvingPromise;
  }

  resolvingPromise = (async () => {
    const hosts = [];

    try {
      const records = await dns.resolveSrv(RADIO_BROWSER_SRV_RECORD);
      for (const record of records) {
        const baseUrl = buildBaseUrl(record?.name);
        if (baseUrl) {
          hosts.push(baseUrl);
        }
      }
    } catch (error) {
      console.warn("radio-browser-srv-resolution-failed", { message: error.message });
    }

    const uniqueHosts = dedupe(hosts.sort((a, b) => a.localeCompare(b)));
    const defaultBase = config.radioBrowser.defaultBaseUrl;

    if (typeof defaultBase === "string" && defaultBase.trim().length > 0) {
      const normalizedDefault = defaultBase.trim();
      if (!uniqueHosts.includes(normalizedDefault)) {
        uniqueHosts.push(normalizedDefault);
      }
    }

    hostPool = uniqueHosts.length > 0 ? uniqueHosts : [config.radioBrowser.defaultBaseUrl];
    if (hostPool.length === 0) {
      hostPool = ["https://api.radio-browser.info"];
    }

    if (hostPool.length > 0) {
      hostIndex = Math.abs(hostIndex) % hostPool.length;
    }

    return hostPool;
  })();

  try {
    return await resolvingPromise;
  } finally {
    resolvingPromise = null;
  }
}

async function ensureBaseUrlInitialized() {
  const hosts = await resolveHostPool();
  if (!hosts || hosts.length === 0) {
    cachedBaseUrl = config.radioBrowser.defaultBaseUrl;
    hostIndex = 0;
    return cachedBaseUrl;
  }

  if (cachedBaseUrl && hosts.includes(cachedBaseUrl)) {
    return cachedBaseUrl;
  }

  hostIndex = Math.floor(Math.random() * hosts.length);
  cachedBaseUrl = hosts[hostIndex];
  return cachedBaseUrl;
}

async function resolveBaseUrl({ rotate = false } = {}) {
  const hosts = await resolveHostPool();

  if (!hosts || hosts.length === 0) {
    cachedBaseUrl = config.radioBrowser.defaultBaseUrl;
    hostIndex = 0;
    return cachedBaseUrl;
  }

  if (rotate) {
    hostIndex = (hostIndex + 1) % hosts.length;
    cachedBaseUrl = hosts[hostIndex];
    return cachedBaseUrl;
  }

  return ensureBaseUrlInitialized();
}

export async function getRadioBrowserBaseUrl(options = {}) {
  return resolveBaseUrl(options);
}

export async function rotateRadioBrowserBaseUrl() {
  return resolveBaseUrl({ rotate: true });
}

export async function buildRadioBrowserUrl(pathname, { baseUrl } = {}) {
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const resolvedBase = baseUrl ?? (await resolveBaseUrl());
  return new URL(normalizedPath, resolvedBase);
}
