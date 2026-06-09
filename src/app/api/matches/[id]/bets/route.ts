// GET /api/matches/:id/bets — reveal all participants' bets for one match
// (06 §3.13, 11 §6). Gated on the SERVER clock: 403 until deadline passes. This
// is the core fairness requirement — never serve another's bet before deadline.
import { and, eq, asc } from "drizzle-orm";
import { route, ok, AppError } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { requireParticipant } from "@/lib/auth";
import { db } from "@/db";
import { matches, matchBets, participants, scoreEvents, matchResults } from "@/db/schema";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (req, ctxArg) => {
  const ctx = await requireParticipant(req);
  enforceRateLimit(req, "me", ctx.user.id);
  const { id } = await ctxArg.params;

  const [match] = await db
    .select({ id: matches.id, deadlineAt: matches.deadlineAt })
    .from(matches)
    .where(eq(matches.id, id))
    .limit(1);
  if (!match) throw new AppError(404, "MATCH_NOT_FOUND", "Match not found");

  if (!match.deadlineAt || new Date() < match.deadlineAt) {
    throw new AppError(403, "REVEAL_BEFORE_DEADLINE", "Bets are still secret", {
      deadline_at: match.deadlineAt?.toISOString() ?? null,
    });
  }

  // Is the result final? points_earned is null until then.
  const [result] = await db
    .select({ resultStatus: matchResults.resultStatus, confirmed: matchResults.confirmed })
    .from(matchResults)
    .where(eq(matchResults.matchId, id))
    .limit(1);
  const resultFinal =
    !!result && ["FT", "AET", "PEN"].includes(result.resultStatus);

  // All active participants (so non-bettors appear with null preds) + their bet
  // + earned points for this match.
  const rows = await db
    .select({
      participantId: participants.id,
      displayName: participants.displayName,
      predHome: matchBets.predHome,
      predAway: matchBets.predAway,
      x2: matchBets.x2,
      penWinner: matchBets.penWinner,
      points: scoreEvents.points,
    })
    .from(participants)
    .leftJoin(matchBets, and(eq(matchBets.participantId, participants.id), eq(matchBets.matchId, id)))
    .leftJoin(
      scoreEvents,
      and(eq(scoreEvents.participantId, participants.id), eq(scoreEvents.matchId, id)),
    )
    .where(eq(participants.status, "ACTIVE"))
    .orderBy(asc(participants.rosterNo));

  return ok({
    match_id: id,
    deadline_at: match.deadlineAt.toISOString(),
    bets: rows.map((r) => ({
      participant_id: r.participantId,
      display_name: r.displayName,
      pred_home: r.predHome,
      pred_away: r.predAway,
      x2: r.x2 ?? false,
      pen_winner: r.penWinner ?? null,
      points_earned: resultFinal && r.points != null ? r.points : null,
    })),
  });
});
