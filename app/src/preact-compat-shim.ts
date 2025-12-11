// Bridge React imports to preact/compat while filling gaps for React 19-only hooks.
// use() and useOptimistic() are stubbed since this app doesn't rely on them.
import preactCompat, { useMemo } from "preact/compat";

export * from "preact/compat";
export default preactCompat;

export function use<T>(value: T): T {
  // Pass through synchronous values; reject promises since suspense for data isn't wired here.
  if (value && typeof (value as unknown as { then?: unknown }).then === "function") {
    throw new Error("Suspense data fetching via use() is not supported in this build.");
  }
  return value;
}

export function useOptimistic<S, A = unknown>(
  state: S,
  _apply?: (currentState: S, action: A) => S,
): [S, (action: A) => void] {
  const dispatcher = useMemo(() => () => undefined, []);
  return [state, dispatcher];
}
