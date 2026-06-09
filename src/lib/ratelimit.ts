// Best-effort in-process rate limiting (06 §1.6, 12 §4.3). A single always-on
// VPS instance makes an in-memory fixed-window counter sufficient for a
// 21-person pool; it resets on restart, which is acceptable here. Track B would
// move this to Redis.
import type { NextRequest } from "next/server";
import { AppError } from "./http";
import { clientMeta } from "./http";

interface Window {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Window>();

function check(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterS: number } {
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterS: 0 };
  }
  existing.count++;
  if (existing.count > limit) {
    return { ok: false, retryAfterS: Math.ceil((existing.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfterS: 0 };
}

export const RATE_TIERS = {
  auth: { limit: 10, windowMs: 60_000 },
  me: { limit: 120, windowMs: 60_000 },
  admin: { limit: 60, windowMs: 60_000 },
  general: { limit: 60, windowMs: 60_000 },
} as const;

/**
 * Enforce a rate tier. `identity` should be a user id for authenticated tiers,
 * else the client IP is used. Throws 429 RATE_LIMITED with retry_after_s.
 */
export function enforceRateLimit(
  req: NextRequest,
  tier: keyof typeof RATE_TIERS,
  identity?: string,
): void {
  const id = identity ?? clientMeta(req).ip ?? "anon";
  const key = `${tier}:${id}`;
  const { limit, windowMs } = RATE_TIERS[tier];
  const { ok, retryAfterS } = check(key, limit, windowMs);
  if (!ok) {
    throw new AppError(429, "RATE_LIMITED", "Rate limit exceeded", { retry_after_s: retryAfterS });
  }
}

// Periodically evict stale windows so the map cannot grow unbounded.
const CLEANUP_INTERVAL_MS = 5 * 60_000;
const timer = setInterval(() => {
  const now = Date.now();
  for (const [k, w] of buckets) if (w.resetAt <= now) buckets.delete(k);
}, CLEANUP_INTERVAL_MS);
// Do not keep the event loop alive just for cleanup.
if (typeof timer.unref === "function") timer.unref();
