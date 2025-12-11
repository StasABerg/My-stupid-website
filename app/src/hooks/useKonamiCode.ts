import { useEffect, useRef } from "react";

const KONAMI_SEQUENCE = [
  "arrowup",
  "arrowup",
  "arrowdown",
  "arrowdown",
  "arrowleft",
  "arrowright",
  "arrowleft",
  "arrowright",
  "b",
  "a",
];

type KonamiCallback = () => void;

export function useKonamiCode(callback: KonamiCallback) {
  const indexRef = useRef(0);
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.repeat) {
        return;
      }
      const key = event.key.toLowerCase();
      const expected = KONAMI_SEQUENCE[indexRef.current];
      if (key === expected) {
        indexRef.current += 1;
        if (indexRef.current === KONAMI_SEQUENCE.length) {
          indexRef.current = 0;
          callbackRef.current();
        }
      } else {
        // reset if mismatch, but allow immediate restart if key matches first entry
        indexRef.current = key === KONAMI_SEQUENCE[0] ? 1 : 0;
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);
}
