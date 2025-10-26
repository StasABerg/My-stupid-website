let cachedToken: { value: string; expiresAt: number } | null = null;
let pending: Promise<string> | null = null;

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
