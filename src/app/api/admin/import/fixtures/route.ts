// POST /api/admin/import/fixtures — import fixtures from the live provider
// (06 §3.15, 08). The provider feed (football-data.org polling + fixture mapping)
// is Track B / Phase 2 (see 13 §4, 14). In Phase 1 the schedule is seeded and the
// admin enters results manually, so this route is gated until FD_TOKEN is set.
import { route, ok, AppError } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { requireAdmin } from "@/lib/auth";
import { env } from "@/lib/env";

export const POST = route(async (req) => {
  const ctx = await requireAdmin(req);
  enforceRateLimit(req, "admin", ctx.user.id);

  if (!env.fdToken) {
    throw new AppError(
      422,
      "PROVIDER_NOT_CONFIGURED",
      "Live results feed is not configured. Phase 1 uses the seeded schedule and manual admin result entry; provider polling is Phase 2.",
    );
  }

  // Phase 2: fetch /v4/competitions/WC/matches, map provider→domain by
  // fifa_match_no, recompute deadlines (kickoff − 3h), upsert, log to
  // provider_sync_log. Intentionally not implemented in Phase 1.
  throw new AppError(501, "NOT_IMPLEMENTED", "Provider fixture import lands in Phase 2");
});
