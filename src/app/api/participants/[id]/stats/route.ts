// GET /api/participants/:id/stats — per-participant match-bet breakdown:
// exact hits / outcome hits / misses, with the per-match detail needed to
// drill in from the leaderboard. Built from score_events, which only exist
// for finished (usable) results — i.e. matches whose deadlines have long
// passed, so nothing secret is revealed here.
import { and, asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { route, ok, AppError } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { requireParticipant } from "@/lib/auth";
import { db } from "@/db";
import { matches, participants, scoreEvents, teams } from "@/db/schema";

type Ctx = { params: Promise<{ id: string }> };

const homeTeam = alias(teams, "stats_home");
const awayTeam = alias(teams, "stats_away");

interface MatchDetail {
  pred?: [number, number];
  toto?: [number, number];
  x2?: boolean;
  exact?: boolean;
  outcome?: boolean;
  noBet?: boolean;
}

export const GET = route<Ctx>(async (req, ctxArg) => {
  const ctx = await requireParticipant(req);
  enforceRateLimit(req, "me", ctx.user.id);
  const { id } = await ctxArg.params;

  const [part] = await db
    .select({ id: participants.id, name: participants.displayName })
    .from(participants)
    .where(eq(participants.id, id))
    .limit(1);
  if (!part) throw new AppError(404, "PARTICIPANT_NOT_FOUND", "Participant not found");

  const rows = await db
    .select({
      matchId: scoreEvents.matchId,
      points: scoreEvents.points,
      detail: scoreEvents.detail,
      no: matches.fifaMatchNo,
      stage: matches.stage,
      homeCode: homeTeam.code,
      homeName: homeTeam.nameRu,
      awayCode: awayTeam.code,
      awayName: awayTeam.nameRu,
    })
    .from(scoreEvents)
    .innerJoin(matches, eq(matches.id, scoreEvents.matchId))
    .leftJoin(homeTeam, eq(homeTeam.id, matches.homeTeamId))
    .leftJoin(awayTeam, eq(awayTeam.id, matches.awayTeamId))
    .where(and(eq(scoreEvents.participantId, id), eq(scoreEvents.source, "MATCH")))
    .orderBy(asc(matches.fifaMatchNo));

  let exact = 0, outcomeOnly = 0, miss = 0, noBet = 0;
  const items = rows.map((r) => {
    const d = (r.detail ?? {}) as MatchDetail;
    const kind = d.noBet ? "NO_BET" : d.exact ? "EXACT" : d.outcome ? "OUTCOME" : "MISS";
    if (kind === "EXACT") exact++;
    else if (kind === "OUTCOME") outcomeOnly++;
    else if (kind === "MISS") miss++;
    else noBet++;
    return {
      match_id: r.matchId,
      fifa_match_no: r.no,
      stage: r.stage,
      home: { code: r.homeCode, name_ru: r.homeName },
      away: { code: r.awayCode, name_ru: r.awayName },
      result: d.toto ?? null,
      pred: d.pred ?? null,
      x2: d.x2 ?? false,
      kind,
      points: r.points,
    };
  });

  return ok({
    participant_id: part.id,
    display_name: part.name,
    summary: { exact, outcome: outcomeOnly, miss, no_bet: noBet },
    matches: items,
  });
});
