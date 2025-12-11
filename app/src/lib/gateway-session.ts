type CachedToken = { value: string; proof: string; expiresAt: number };

let cachedToken: CachedToken | null = null;
let pending: Promise<CachedToken> | null = null;

const TOKEN_STORAGE_KEY = "gateway.session.token";

const storage = (() => {
  try {
    const store = window.localStorage;
    store.getItem(TOKEN_STORAGE_KEY);
    return store;
  } catch {
    return null;
  }
})();

function readToken(): CachedToken | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(TOKEN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.value === "string" &&
      typeof parsed.proof === "string" &&
      typeof parsed.expiresAt === "number"
    ) {
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

function persist(token: CachedToken | null) {
  if (!storage) return;
  try {
    if (token) {
      storage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(token));
    } else {
      storage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

const stored = readToken();
if (stored && stored.expiresAt > Date.now()) {
  cachedToken = stored;
}

const SESSION_ENDPOINT = "/api/session";

async function requestSession(): Promise<CachedToken> {
  const resp = await fetch(SESSION_ENDPOINT, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  if (!resp.ok) throw new Error(`session status ${resp.status}`);
  const payload = (await resp.json()) as { csrfToken?: string; csrfProof?: string; expiresAt?: number };
  if (!payload.csrfToken || !payload.csrfProof) throw new Error("missing csrf");
  const token = {
    value: payload.csrfToken,
    proof: payload.csrfProof,
    expiresAt: payload.expiresAt ?? Date.now() + 1000 * 60 * 20,
  };
  cachedToken = token;
  persist(token);
  return token;
}

export async function ensureGatewaySession(): Promise<{ token: string; proof: string }> {
  if (cachedToken && cachedToken.expiresAt - Date.now() > 30_000) {
    return { token: cachedToken.value, proof: cachedToken.proof };
  }
  if (!pending) {
    pending = requestSession().finally(() => {
      pending = null;
    });
  }
  const session = await pending;
  return { token: session.value, proof: session.proof };
}

export async function authorizedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const session = await ensureGatewaySession();
  const headers = new Headers(init.headers ?? {});
  headers.set("X-Gateway-CSRF", session.token);
  headers.set("X-Gateway-CSRF-Proof", session.proof);
  const finalInit: RequestInit = { ...init, headers, credentials: "include" };
  const resp = await fetch(input, finalInit);
  if (resp.status === 401 || resp.status === 403) {
    cachedToken = null;
    persist(null);
    const fresh = await ensureGatewaySession();
    headers.set("X-Gateway-CSRF", fresh.token);
    headers.set("X-Gateway-CSRF-Proof", fresh.proof);
    return fetch(input, { ...init, headers, credentials: "include" });
  }
  return resp;
}
