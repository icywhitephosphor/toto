// PATCH /api/admin/matches/:id/result — set or override a match result (06 §3.16,
// 08 manual-override). Computes the canonical toto score if omitted, sets the
// winner, writes match_results + audit, and (when confirmed) triggers a recompute
// so the leaderboard updates immediately. This is the Phase-1 scoring path.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { route, ok, AppError, clientMeta, parseJson } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/db";
import { matches, matchResults } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { recomputeAll } from "@/lib/recompute";
import { totoScore } from "@/scoring";

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  base_home: z.number().int().nullable().optional(),
  base_away: z.number().int().nullable().optional(),
  pen_home: z.number().int().nullable().optional(),
  pen_away: z.number().int().nullable().optional(),
  toto_home: z.number().int().nullable().optional(),
  toto_away: z.number().int().nullable().optional(),
  result_status: z.enum(["FT", "AET", "PEN", "CANCELLED"]),
  status: z.enum(["SCHEDULED", "LIVE", "AWAITING_CONFIRM", "FINAL", "CANCELLED"]).optional(),
  confirmed: z.boolean().optional(),
  source: z.enum(["PROVIDER", "ADMIN"]).optional(),
  reason: z.string().optional(),
});

export const PATCH = route<Ctx>(async (req, ctxArg) => {
  const ctx = await requireAdmin(req);
  enforceRateLimit(req, "admin", ctx.user.id);
  const { id } = await ctxArg.params;
  const meta = clientMeta(req);

  const [match] = await db
    .select({
      id: matches.id,
      fifaMatchNo: matches.fifaMatchNo,
      stage: matches.stage,
      x2Allowed: matches.x2Allowed,
      homeTeamId: matches.homeTeamId,
      awayTeamId: matches.awayTeamId,
    })
    .from(matches)
    .where(eq(matches.id, id))
    .limit(1);
  if (!match) throw new AppError(404, "MATCH_NOT_FOUND", "Match not found");

  const body = await parseJson(req, bodySchema);
  const isPlayoff = match.x2Allowed;
  const cancelled = body.result_status === "CANCELLED";

  if (!isPlayoff && (body.pen_home != null || body.pen_away != null)) {
    throw new AppError(422, "GROUP_MATCH_HAS_PENALTY", "Group-stage match cannot have penalty scores");
  }
  if (body.result_status === "PEN" && (body.pen_home == null || body.pen_away == null)) {
    throw new AppError(422, "MISSING_PEN_SCORES", "Penalty result requires pen_home and pen_away");
  }

  // Canonical toto score (05 §2) unless explicitly provided. Null for cancelled.
  let totoHome: number | null = null;
  let totoAway: number | null = null;
  if (!cancelled) {
    if (body.toto_home != null && body.toto_away != null) {
      totoHome = body.toto_home;
      totoAway = body.toto_away;
    } else if (body.base_home != null && body.base_away != null) {
      const toto = totoScore({
        baseHome: body.base_home,
        baseAway: body.base_away,
        penHome: body.pen_home ?? null,
        penAway: body.pen_away ?? null,
      });
      totoHome = toto.home;
      totoAway = toto.away;
    } else {
      throw new AppError(422, "MISSING_SCORE", "Provide base_home/base_away (or toto_home/toto_away)");
    }
  }

  const confirmed = cancelled ? false : (body.confirmed ?? true);
  const matchStatus = cancelled ? "CANCELLED" : (body.status ?? (confirmed ? "FINAL" : "AWAITING_CONFIRM"));

  let winnerTeamId: string | null = null;
  if (!cancelled && totoHome != null && totoAway != null) {
    if (totoHome > totoAway) winnerTeamId = match.homeTeamId;
    else if (totoAway > totoHome) winnerTeamId = match.awayTeamId;
  }

  const [before] = await db.select().from(matchResults).where(eq(matchResults.matchId, id)).limit(1);

  await db.transaction(async (tx) => {
    const values = {
      matchId: id,
      resultStatus: body.result_status,
      baseHome: body.base_home ?? null,
      baseAway: body.base_away ?? null,
      penHome: body.pen_home ?? null,
      penAway: body.pen_away ?? null,
      totoHome,
      totoAway,
      winnerTeamId,
      source: body.source ?? "ADMIN",
      confirmed,
      updatedBy: ctx.user.id,
      updatedAt: new Date(),
    };

    await tx
      .insert(matchResults)
      .values(values)
      .onConflictDoUpdate({ target: matchResults.matchId, set: values });

    await tx.update(matches).set({ status: matchStatus, updatedAt: new Date() }).where(eq(matches.id, id));

    await writeAudit(tx, {
      actorUserId: ctx.user.id,
      actorKind: "ADMIN",
      action: "RESULT_OVERRIDE",
      entityType: "match_result",
      entityId: id,
      before: before ?? null,
      after: values,
      reason: body.reason ?? null,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  });

  let recomputeTriggered = false;
  if (confirmed) {
    await recomputeAll(`матч №${match.fifaMatchNo} — результат внесён`, ctx.user.id);
    recomputeTriggered = true;
  }

  return ok({
    match_id: id,
    result: {
      result_status: body.result_status,
      base_home: body.base_home ?? null,
      base_away: body.base_away ?? null,
      pen_home: body.pen_home ?? null,
      pen_away: body.pen_away ?? null,
      toto_home: totoHome,
      toto_away: totoAway,
      confirmed,
      source: body.source ?? "ADMIN",
    },
    recompute_triggered: recomputeTriggered,
  });
});
