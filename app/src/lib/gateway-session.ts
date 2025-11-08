type CachedToken = { value: string; proof: string; expiresAt: number };

let cachedToken: CachedToken | null = null;
let pending: Promise<CachedToken> | null = null;

const LEGACY_STORAGE_KEY = "gateway.session";
const TOKEN_STORAGE_KEY = "gateway.session.token";
const TOKEN_STORAGE_PREFIX = "gateway.session.token.";

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
const storageCandidates = [localStorageRef, sessionStorageRef].filter(
  (value): value is StorageLike => value !== null,
);

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
      typeof (parsed as Record<string, unknown>).proof === "string" &&
      typeof (parsed as Record<string, unknown>).expiresAt === "number"
    ) {
      return parsed as CachedToken;
    }
  } catch {
    // ignore JSON errors
  }

  return null;
}

function readTokenFromStorage(storage: StorageLike, key: string): CachedToken | null {
  try {
    return parseCachedToken(storage.getItem(key));
  } catch {
    return null;
  }
}

function findLegacyToken(storage: StorageLike): CachedToken | null {
  const legacyToken = readTokenFromStorage(storage, LEGACY_STORAGE_KEY);
  if (legacyToken) {
    return legacyToken;
  }

  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key || !key.startsWith(TOKEN_STORAGE_PREFIX)) {
        continue;
      }
      const token = readTokenFromStorage(storage, key);
      if (token) {
        return token;
      }
    }
  } catch {
    // ignore storage iteration errors
  }

  return null;
}

function removeLegacyTokens(storage: StorageLike) {
  try {
    storage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // ignore cleanup errors
  }

  try {
    const keysToRemove: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key) {
        continue;
      }
      const isLegacyPrefixed = key.startsWith(TOKEN_STORAGE_PREFIX) && key !== TOKEN_STORAGE_KEY;
      if (isLegacyPrefixed) {
        keysToRemove.push(key);
      }
    }

    for (const key of keysToRemove) {
      try {
        storage.removeItem(key);
      } catch {
        // ignore cleanup errors
      }
    }
  } catch {
    // ignore iteration cleanup errors
  }
}

function readStoredToken(): CachedToken | null {
  for (const storage of storageCandidates) {
    const token = readTokenFromStorage(storage, TOKEN_STORAGE_KEY);
    if (token) {
      return token;
    }
  }

  for (const storage of storageCandidates) {
    const legacyToken = findLegacyToken(storage);
    if (legacyToken) {
      persistToken(legacyToken);
      removeLegacyTokens(storage);
      return legacyToken;
    }
  }

  return null;
}

function persistToken(token: CachedToken | null) {
  if (!tokenStorage) {
    return;
  }

  try {
    if (token) {
      tokenStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(token));
    } else {
      tokenStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }

  for (const storage of storageCandidates) {
    removeLegacyTokens(storage);
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
  if (typeof token.value !== "string" || token.value.length === 0) return false;
  if (typeof token.proof !== "string" || token.proof.length === 0) return false;
  const now = Date.now();
  // Refresh a little before expiry to avoid races
  return token.expiresAt - now > 30_000;
}

async function requestNewSession(): Promise<CachedToken> {
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

  const payload: { csrfToken?: string; csrfProof?: string; expiresAt?: number } = await response.json();
  if (!payload.csrfToken || typeof payload.csrfToken !== "string") {
    throw new Error("Session response missing csrfToken");
  }
  if (!payload.csrfProof || typeof payload.csrfProof !== "string") {
    throw new Error("Session response missing csrfProof");
  }
  const expiresAt =
    typeof payload.expiresAt === "number" && Number.isFinite(payload.expiresAt)
      ? payload.expiresAt
      : Date.now() + 1000 * 60 * 30;

  cachedToken = { value: payload.csrfToken, proof: payload.csrfProof, expiresAt };
  persistToken(cachedToken);
  return cachedToken;
}

export async function ensureGatewaySession(): Promise<{ token: string; proof: string }> {
  if (isTokenValid(cachedToken)) {
    return { token: cachedToken!.value, proof: cachedToken!.proof };
  }

  if (!pending) {
    pending = requestNewSession().finally(() => {
      pending = null;
    });
  }

  const session = await pending;
  return { token: session.value, proof: session.proof };
}

export async function authorizedFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const session = await ensureGatewaySession();
  const headers = new Headers(init.headers ?? {});
  headers.set("X-Gateway-CSRF", session.token);
  headers.set("X-Gateway-CSRF-Proof", session.proof);

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
    const freshSession = await pending;
    headers.set("X-Gateway-CSRF", freshSession.value);
    headers.set("X-Gateway-CSRF-Proof", freshSession.proof);
    const retryInit: RequestInit = {
      ...init,
      headers,
      credentials: "include",
    };
    return fetch(input, retryInit);
  }

  return response;
}
