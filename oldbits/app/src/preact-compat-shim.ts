// Bridge React imports to preact/compat and stub React 19-only hooks we don't use.
import preactCompat from "preact/compat";
import { useMemo } from "preact/hooks";

export * from "preact/compat";
export default preactCompat;

export function use<T>(value: T): T {
  // Pass through synchronous values only.
  if (value && typeof (value as unknown as { then?: unknown }).then === "function") {
    throw new Error("Suspense data fetching via use() is not supported in this build.");
  }
  return value;
}

export function useOptimistic<S>(state: S): [S, () => void] {
  const dispatcher = useMemo(() => () => undefined, []);
  return [state, dispatcher];
}
