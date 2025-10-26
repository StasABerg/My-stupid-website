type CachedToken = { value: string; expiresAt: number };

let cachedToken: CachedToken | null = null;
let pending: Promise<string> | null = null;

const STORAGE_KEY = "gateway.session";

function readStoredToken(): CachedToken | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.value === "string" &&
      typeof parsed.expiresAt === "number"
    ) {
      return parsed as CachedToken;
    }
  } catch {
    // ignore storage errors
  }
  return null;
}

function persistToken(token: CachedToken | null) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    if (token) {
      window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(token));
    } else {
      window.localStorage?.removeItem(STORAGE_KEY);
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
