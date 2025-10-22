import { Agent, fetch } from "undici";

const keepAliveAgent = new Agent({
  connections: 2000,
  keepAliveTimeout: 60_000,
  keepAliveMaxTimeout: 120_000,
});

export function fetchWithKeepAlive(url, options = {}) {
  const dispatcher = options.dispatcher ?? keepAliveAgent;
  return fetch(url, { ...options, dispatcher });
}

export { keepAliveAgent };
