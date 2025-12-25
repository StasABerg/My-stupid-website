const CACHE_NAME = "gitgud-radio-shell-v7";
const APP_SHELL = ["/", "/radio"];
const APP_SHELL_PATHS = new Set(APP_SHELL);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => {
        /* best-effort cache seed */
      })
      .finally(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    return;
  }

  const isNavigation = event.request.mode === "navigate";
  const isShellAsset = APP_SHELL_PATHS.has(url.pathname);
  if (!isNavigation && !isShellAsset) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && (response.ok || response.type === "opaqueredirect" || response.type === "opaque")) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            void cache.put(event.request, clone);
          });
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) {
          return cached;
        }
        if (isNavigation) {
          const shell = await caches.match("/radio");
          if (shell) return shell;
        }
        throw new Error("Network error and no cached response available");
      }),
  );
});
