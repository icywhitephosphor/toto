// GET /api/bonus/reveal — reveal all participants' bonus bets across all 7
// categories, available only after the global bonus deadline (06 §3.14, 11 §6).
// 403 REVEAL_BEFORE_DEADLINE until then. points_earned is null until a category
// is settled by the admin.
import { eq, asc, inArray } from "drizzle-orm";
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

  const categories = cats.map((cat) => {
    const settled = actualByCat.has(cat.id);
    const byPart = picks.get(cat.id) ?? new Map();
    const ptsByPart = pointsByCatPart.get(cat.id) ?? new Map();
    return {
      category_id: cat.id,
      name_ru: cat.nameRu,
      item_count: cat.itemCount,
      points_per_correct: cat.pointsPerCorrect,
      settled,
      actual_items: settled ? actualByCat.get(cat.id)! : null,
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

  return ok({ bonus_deadline_at: t.bonusDeadlineAt.toISOString(), categories });
});
