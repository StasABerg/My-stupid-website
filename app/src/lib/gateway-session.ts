type CachedToken = { value: string; expiresAt: number };

let cachedToken: CachedToken | null = null;
let pending: Promise<string> | null = null;

const LEGACY_STORAGE_KEY = "gateway.session";
const TOKEN_STORAGE_PREFIX = "gateway.session.token.";
const TAB_ID_STORAGE_KEY = "gateway.session.tab-id";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

function resolveStorage(accessor: () => Storage | undefined): StorageLike | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const storage = accessor();
    if (!storage) {
      return null;
    }
    // Accessing the storage in private browsing can throw, so we guard with try/catch
    storage.getItem(LEGACY_STORAGE_KEY);
    return storage;
  } catch {
    return null;
  }
}

const sessionStorageRef = resolveStorage(() => window.sessionStorage);
const localStorageRef = resolveStorage(() => window.localStorage);
const tokenStorage = localStorageRef ?? sessionStorageRef;

let tabId: string | null | undefined;

function ensureTabId(): string | null {
  if (tabId !== undefined) {
    return tabId;
  }

  if (!sessionStorageRef) {
    tabId = null;
    return tabId;
  }

  try {
    const existing = sessionStorageRef.getItem(TAB_ID_STORAGE_KEY);
    if (existing) {
      tabId = existing;
      return existing;
    }

    const generated =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`;
    sessionStorageRef.setItem(TAB_ID_STORAGE_KEY, generated);
    tabId = generated;
    return generated;
  } catch {
    tabId = null;
    return tabId;
  }
}

function getTokenStorageKey(): string {
  const id = ensureTabId();
  return id ? `${TOKEN_STORAGE_PREFIX}${id}` : LEGACY_STORAGE_KEY;
}

function parseCachedToken(raw: string | null): CachedToken | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>).value === "string" &&
      typeof (parsed as Record<string, unknown>).expiresAt === "number"
    ) {
      return parsed as CachedToken;
    }
  } catch {
    // ignore JSON errors
  }

  return null;
}

function readStoredToken(): CachedToken | null {
  if (!tokenStorage) {
    return null;
  }

  const primaryKey = getTokenStorageKey();
  const keysToInspect =
    primaryKey === LEGACY_STORAGE_KEY ? [primaryKey] : [primaryKey, LEGACY_STORAGE_KEY];

  for (const key of keysToInspect) {
    try {
      const token = parseCachedToken(tokenStorage.getItem(key));
      if (!token) {
        continue;
      }

      if (key === LEGACY_STORAGE_KEY && primaryKey !== LEGACY_STORAGE_KEY) {
        // Migrate legacy entries written before per-tab storage was introduced.
        persistToken(token);
        try {
          tokenStorage.removeItem(LEGACY_STORAGE_KEY);
        } catch {
          // ignore cleanup errors
        }
      }

      return token;
    } catch {
      // ignore storage errors
    }
  }

  return null;
}

function persistToken(token: CachedToken | null) {
  if (!tokenStorage) {
    return;
  }

  try {
    const key = getTokenStorageKey();
    if (token) {
      tokenStorage.setItem(key, JSON.stringify(token));
    } else {
      tokenStorage.removeItem(key);
      if (key !== LEGACY_STORAGE_KEY) {
        tokenStorage.removeItem(LEGACY_STORAGE_KEY);
      }
    }
  } catch {
    // ignore storage errors
  }
}

const storedToken = readStoredToken();
if (storedToken && storedToken.expiresAt > Date.now()) {
  cachedToken = storedToken;
} else if (storedToken) {
  persistToken(null);
}

const SESSION_ENDPOINT = "/api/session";

function isTokenValid(token: typeof cachedToken) {
  if (!token) return false;
  const now = Date.now();
  // Refresh a little before expiry to avoid races
  return token.expiresAt - now > 30_000;
}

async function requestNewSession(): Promise<string> {
  const response = await fetch(SESSION_ENDPOINT, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to initialize session (status ${response.status})`);
  }

  const payload: { csrfToken?: string; expiresAt?: number } = await response.json();
  if (!payload.csrfToken || typeof payload.csrfToken !== "string") {
    throw new Error("Session response missing csrfToken");
  }
  const expiresAt =
    typeof payload.expiresAt === "number" && Number.isFinite(payload.expiresAt)
      ? payload.expiresAt
      : Date.now() + 1000 * 60 * 30;

  cachedToken = { value: payload.csrfToken, expiresAt };
  persistToken(cachedToken);
  return payload.csrfToken;
}

export async function ensureGatewaySession(): Promise<string> {
  if (isTokenValid(cachedToken)) {
    return cachedToken!.value;
  }

  if (!pending) {
    pending = requestNewSession().finally(() => {
      pending = null;
    });
  }

  return pending;
}

export async function authorizedFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const token = await ensureGatewaySession();
  const headers = new Headers(init.headers ?? {});
  headers.set("X-Gateway-CSRF", token);

  const finalInit: RequestInit = {
    ...init,
    headers,
    credentials: "include",
  };

  const response = await fetch(input, finalInit);

  if (response.status === 401 || response.status === 403) {
    // Invalidate and retry once
    cachedToken = null;
    persistToken(null);
    if (!pending) {
      pending = requestNewSession().finally(() => {
        pending = null;
      });
    }
    const freshToken = await pending;
    headers.set("X-Gateway-CSRF", freshToken);
    const retryInit: RequestInit = {
      ...init,
      headers,
      credentials: "include",
    };
    return fetch(input, retryInit);
  }

  return response;
}
