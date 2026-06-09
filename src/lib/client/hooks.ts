"use client";
import { useEffect, useState } from "react";
import { useBootstrap } from "./bootstrap";

/** Re-renders every `ms`, returning the current local epoch ms. */
export function useTick(ms = 1000): number {
  const [n, setN] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setN(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return n;
}

/** Server-aligned current time (ms), ticking every `ms`. Cosmetic only — the
 *  server is the authoritative clock for all lock decisions (11 §3.3). */
export function useServerClock(ms = 1000): number {
  const { skewMs } = useBootstrap();
  const t = useTick(ms);
  return t + skewMs;
}
