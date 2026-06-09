// POST /api/admin/recalculate — full, idempotent scoring recompute (06 §3.17, 05 §7).
import { route, ok } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { requireAdmin } from "@/lib/auth";
import { recomputeAll } from "@/lib/recompute";
import { exportSheetsInBackground } from "@/lib/sheets";

export const POST = route(async (req) => {
  const ctx = await requireAdmin(req);
  enforceRateLimit(req, "admin", ctx.user.id);

  let reason = "manual recalculate";
  try {
    const body = await req.json();
    if (body && typeof body.reason === "string") reason = body.reason;
  } catch {
    // empty body is fine
  }

  const result = await recomputeAll(reason, ctx.user.id);
  exportSheetsInBackground();
  return ok({
    score_events_upserted: result.scoreEventsUpserted,
    snapshot_id: result.snapshotId,
    duration_ms: result.durationMs,
  });
});
