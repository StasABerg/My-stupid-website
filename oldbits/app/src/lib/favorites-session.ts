const STORAGE_KEY = "radio.favorites.session";

let cachedSessionId: string | null = null;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function resolveStorage(accessor: () => Storage | undefined): StorageLike | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const storage = accessor();
    if (!storage) {
      return null;
    }
    storage.getItem(STORAGE_KEY);
    return storage;
  } catch {
    return null;
  }
}

const storageCandidates = [resolveStorage(() => window.localStorage), resolveStorage(() => window.sessionStorage)].filter(
  (value): value is StorageLike => value !== null,
);

function readStoredSessionId(): string | null {
  for (const storage of storageCandidates) {
    try {
      const value = storage.getItem(STORAGE_KEY);
      if (typeof value === "string" && value.length >= 16 && value.length <= 128) {
        return value;
      }
    } catch {
      // ignore read errors
    }
  }
  return null;
}

function persistSessionId(value: string | null) {
  for (const storage of storageCandidates) {
    try {
      if (value) {
        storage.setItem(STORAGE_KEY, value);
      } else {
        storage.removeItem(STORAGE_KEY);
      }
    } catch {
      // ignore write errors
    }
  }
}

function randomSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "");
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

const stored = readStoredSessionId();
if (stored) {
  cachedSessionId = stored;
}

export function getFavoritesSessionId(): string {
  if (cachedSessionId) {
    return cachedSessionId;
  }
  const generated = randomSessionId();
  cachedSessionId = generated;
  persistSessionId(generated);
  return generated;
}
