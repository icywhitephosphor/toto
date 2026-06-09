// GET /api/participants — roster for the claim screen (07 §5.1). Returns each
// roster slot with a `claimed` flag; the UI offers only unclaimed names. Auth
// required so the list is not exposed to anonymous visitors.
import { asc } from "drizzle-orm";
import { route, ok } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { requireUser } from "@/lib/auth";
import { db } from "@/db";
import { participants } from "@/db/schema";

export const GET = route(async (req) => {
  enforceRateLimit(req, "general");
  const ctx = await requireUser(req);

  const rows = await db
    .select({
      id: participants.id,
      rosterNo: participants.rosterNo,
      displayName: participants.displayName,
      userId: participants.userId,
    })
    .from(participants)
    .orderBy(asc(participants.rosterNo));

  return ok({
    participants: rows.map((r) => ({
      id: r.id,
      roster_no: r.rosterNo,
      display_name: r.displayName,
      claimed: r.userId != null,
      is_self: r.userId === ctx.user.id,
    })),
  });
});
