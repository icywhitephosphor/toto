"use client";
import { useEffect, useState } from "react";
import { useBootstrap } from "./bootstrap";

// One shared interval per period, fanned out to every subscriber. The matches
// list mounts ~100 cards that each want a 1s clock; without sharing that is
// ~100 timers drifting independently. Here a single timer per `ms` drives them
// all in lockstep and is torn down when the last subscriber unmounts.
interface Ticker {
  subs: Set<() => void>;
  id: ReturnType<typeof setInterval> | null;
  now: number;
}
const tickers = new Map<number, Ticker>();

function subscribe(ms: number, cb: () => void): () => void {
  let t = tickers.get(ms);
  if (!t) {
    t = { subs: new Set(), id: null, now: Date.now() };
    tickers.set(ms, t);
  }
  const ticker = t;
  ticker.subs.add(cb);
  if (ticker.id === null) {
    ticker.id = setInterval(() => {
      ticker.now = Date.now();
      for (const s of ticker.subs) s();
    }, ms);
  }
  return () => {
    ticker.subs.delete(cb);
    if (ticker.subs.size === 0 && ticker.id !== null) {
      clearInterval(ticker.id);
      ticker.id = null;
      tickers.delete(ms);
    }
  };
}

/** Re-renders every `ms`, returning the current local epoch ms. Backed by a
 *  process-wide shared timer per period (see above). */
export function useTick(ms = 1000): number {
  const [n, setN] = useState(() => tickers.get(ms)?.now ?? Date.now());
  useEffect(() => {
    // Sync immediately in case the shared ticker advanced before we subscribed.
    setN(tickers.get(ms)?.now ?? Date.now());
    return subscribe(ms, () => setN(tickers.get(ms)?.now ?? Date.now()));
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
