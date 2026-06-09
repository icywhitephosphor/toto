// GET /api/matches — list matches, optionally filtered (06 §3.6). Public.
import { route, ok } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { listMatches } from "@/lib/api/match-queries";

export const GET = route(async (req) => {
  enforceRateLimit(req, "general");
  const url = new URL(req.url);
  const fromStr = url.searchParams.get("from");
  const toStr = url.searchParams.get("to");

  const matches = await listMatches({
    stage: url.searchParams.get("stage") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    from: fromStr ? new Date(fromStr) : undefined,
    to: toStr ? new Date(toStr) : undefined,
  });

  return ok({ matches });
});
