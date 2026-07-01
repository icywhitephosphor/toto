// GET /api/bonus/reveal — reveal all participants' bonus bets across all 7
// categories, available only after the global bonus deadline (06 §3.14, 11 §6).
// 403 REVEAL_BEFORE_DEADLINE until then. points_earned is null until a category
// is settled by the admin.
import { eq, asc, and, ne, inArray, isNotNull } from "drizzle-orm";
import { route, ok, AppError } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { requireParticipant } from "@/lib/auth";
import { db } from "@/db";
import {
  bonusCategories,
  bonusBets,
  bonusBetItems,
  bonusOutcomes,
  scoreEvents,
  participants,
  teams,
  matches,
  matchResults,
} from "@/db/schema";
import { getTournament, isBonusLocked } from "@/lib/api/tournament";
import { TOURNAMENT_ID } from "@/lib/env";

export const GET = route(async (req) => {
  const ctx = await requireParticipant(req);
  enforceRateLimit(req, "me", ctx.user.id);

  const t = await getTournament();
  if (!isBonusLocked(t)) {
    throw new AppError(403, "REVEAL_BEFORE_DEADLINE", "Bonus bets are still secret", {
      deadline_at: t.bonusDeadlineAt.toISOString(),
    });
  }

  const cats = await db
    .select()
    .from(bonusCategories)
    .where(eq(bonusCategories.tournamentId, TOURNAMENT_ID))
    .orderBy(asc(bonusCategories.sortOrder));

  const parts = await db
    .select({ id: participants.id, displayName: participants.displayName })
    .from(participants)
    .where(eq(participants.status, "ACTIVE"))
    .orderBy(asc(participants.rosterNo));

  const betRows = await db
    .select({ id: bonusBets.id, participantId: bonusBets.participantId, categoryId: bonusBets.categoryId })
    .from(bonusBets);
  const betMeta = new Map(betRows.map((b) => [b.id, b]));

  const itemRows = betRows.length
    ? await db
        .select({
          bonusBetId: bonusBetItems.bonusBetId,
          teamId: bonusBetItems.teamId,
          playerName: bonusBetItems.playerName,
          position: bonusBetItems.position,
          code: teams.code,
          nameRu: teams.nameRu,
        })
        .from(bonusBetItems)
        .leftJoin(teams, eq(teams.id, bonusBetItems.teamId))
        .where(inArray(bonusBetItems.bonusBetId, betRows.map((b) => b.id)))
    : [];

  // picks[categoryId][participantId] = item[]
  const picks = new Map<string, Map<string, Array<{ team_id?: string; code?: string | null; name_ru?: string | null; player_name?: string | null }>>>();
  for (const it of itemRows) {
    const bet = betMeta.get(it.bonusBetId);
    if (!bet) continue;
    if (!picks.has(bet.categoryId)) picks.set(bet.categoryId, new Map());
    const byPart = picks.get(bet.categoryId)!;
    if (!byPart.has(bet.participantId)) byPart.set(bet.participantId, []);
    byPart.get(bet.participantId)!.push(
      it.teamId
        ? { team_id: it.teamId, code: it.code, name_ru: it.nameRu, position: it.position } as never
        : { player_name: it.playerName, position: it.position } as never,
    );
  }

  // points[categoryId][participantId]
  const scoreRows = await db
    .select({ participantId: scoreEvents.participantId, categoryId: scoreEvents.categoryId, points: scoreEvents.points })
    .from(scoreEvents)
    .where(eq(scoreEvents.source, "BONUS"));
  const pointsByCatPart = new Map<string, Map<string, number>>();
  for (const r of scoreRows) {
    if (!r.categoryId) continue;
    if (!pointsByCatPart.has(r.categoryId)) pointsByCatPart.set(r.categoryId, new Map());
    pointsByCatPart.get(r.categoryId)!.set(r.participantId, r.points);
  }

  // actual outcomes per category
  const outcomeRows = await db
    .select({ categoryId: bonusOutcomes.categoryId, teamId: bonusOutcomes.teamId, playerName: bonusOutcomes.playerName, code: teams.code, nameRu: teams.nameRu })
    .from(bonusOutcomes)
    .leftJoin(teams, eq(teams.id, bonusOutcomes.teamId));
  const actualByCat = new Map<string, Array<{ team_id?: string; code?: string | null; name_ru?: string | null; player_name?: string | null }>>();
  for (const o of outcomeRows) {
    if (!actualByCat.has(o.categoryId)) actualByCat.set(o.categoryId, []);
    actualByCat.get(o.categoryId)!.push(
      o.teamId ? { team_id: o.teamId, code: o.code, name_ru: o.nameRu } : { player_name: o.playerName },
    );
  }

  // Teams eliminated so far = losers of completed (usable) knockout matches.
  // A picked team that's already out is a DEFINITIVE miss for any stage-participant
  // / champion category even before the round finishes (symmetric to early
  // crediting); a still-alive pick stays neutral until it advances or is out.
  const koResults = await db
    .select({
      homeTeamId: matches.homeTeamId,
      awayTeamId: matches.awayTeamId,
      winnerTeamId: matchResults.winnerTeamId,
    })
    .from(matches)
    .innerJoin(matchResults, eq(matchResults.matchId, matches.id))
    .where(
      and(
        ne(matches.stage, "GROUP"),
        inArray(matchResults.resultStatus, ["FT", "AET", "PEN"]),
        eq(matchResults.confirmed, true),
        isNotNull(matchResults.winnerTeamId),
      ),
    );
  const eliminated = new Set<string>();
  for (const r of koResults) {
    const loser = r.winnerTeamId === r.homeTeamId ? r.awayTeamId : r.homeTeamId;
    if (loser) eliminated.add(loser);
  }

  // Teams that reached the knockouts = the R32 bracket. A picked team NOT here
  // never made it out of the group → also a definitive miss for any knockout
  // category (Turkey, Scotland, …). Only trusted once the bracket is seeded
  // (non-empty), so a pre-seed reveal can't wrongly strike everyone.
  const r32Rows = await db
    .select({ home: matches.homeTeamId, away: matches.awayTeamId })
    .from(matches)
    .where(eq(matches.stage, "R32"));
  const qualified = new Set<string>();
  for (const m of r32Rows) {
    if (m.home) qualified.add(m.home);
    if (m.away) qualified.add(m.away);
  }

  const categories = cats.map((cat) => {
    const settled = actualByCat.has(cat.id);
    const actual = actualByCat.get(cat.id) ?? [];
    // Final answer set is fully known once it reaches its size (one team per slot;
    // a manual single-player category is complete as soon as it's settled).
    const complete = cat.itemType === "PLAYER" ? settled : actual.length >= cat.itemCount;
    const byPart = picks.get(cat.id) ?? new Map();
    const ptsByPart = pointsByCatPart.get(cat.id) ?? new Map();
    return {
      category_id: cat.id,
      name_ru: cat.nameRu,
      item_count: cat.itemCount,
      item_type: cat.itemType as "TEAM" | "PLAYER",
      points_per_correct: cat.pointsPerCorrect,
      settled,
      complete,
      actual_items: settled ? actual : null,
      participants: parts.map((p) => {
        const items = (byPart.get(p.id) ?? [])
          .slice()
          .sort((a: { position?: number }, b: { position?: number }) => (a.position ?? 0) - (b.position ?? 0))
          .map(({ position: _pos, ...rest }: { position?: number }) => rest);
        return {
          participant_id: p.id,
          display_name: p.displayName,
          items,
          points_earned: settled ? (ptsByPart.get(p.id) ?? 0) : null,
        };
      }),
    };
  });

  return ok({
    bonus_deadline_at: t.bonusDeadlineAt.toISOString(),
    eliminated_team_ids: [...eliminated],
    qualified_team_ids: [...qualified],
    categories,
  });
});
