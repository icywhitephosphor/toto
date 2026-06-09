// GET /api/admin/provider/status — last provider sync + quota (06 §3.19). In
// Phase 1 (no live feed wired) this typically returns last_sync: null.
import { desc, eq } from "drizzle-orm";
import { route, ok } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/db";
import { providerSyncLog } from "@/db/schema";
import { env } from "@/lib/env";

export const GET = route(async (req) => {
  const ctx = await requireAdmin(req);
  enforceRateLimit(req, "admin", ctx.user.id);

  const recent = await db
    .select()
    .from(providerSyncLog)
    .orderBy(desc(providerSyncLog.startedAt))
    .limit(10);

  const last = recent[0] ?? null;
  const recentErrors = recent.filter((r) => !r.ok).slice(0, 5);

  return ok({
    provider: "football-data.org",
    configured: env.fdToken != null,
    last_sync: last
      ? {
          id: last.id,
          endpoint: last.endpoint,
          http_status: last.httpStatus,
          items: last.items,
          ok: last.ok,
          quota_remaining: last.quotaRemaining,
          started_at: last.startedAt.toISOString(),
          finished_at: last.finishedAt?.toISOString() ?? null,
        }
      : null,
    recent_errors: recentErrors.map((r) => ({ id: r.id, error: r.error, started_at: r.startedAt.toISOString() })),
    quota_remaining: last?.quotaRemaining ?? null,
  });
});
