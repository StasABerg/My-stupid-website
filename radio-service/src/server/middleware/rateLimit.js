export function createRateLimitOptions() {
  const fifteenMinutesMs = 15 * 60 * 1000;
  return {
    global: true,
    max: 100,
    timeWindow: fifteenMinutesMs,
    skipOnError: false,
    addHeaders: {
      "x-ratelimit-limit": true,
      "x-ratelimit-remaining": true,
      "x-ratelimit-reset": true,
      "retry-after": true,
    },
    allowList: (request) => {
      const url = request.routeOptions?.url ?? request.routerPath;
      return url === "/healthz";
    },
  };
}
