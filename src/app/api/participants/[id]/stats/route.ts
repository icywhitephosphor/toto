// GET /api/participants/:id/stats — per-participant breakdown for the leaderboard
// drill-in AND the profile page (/participant/[id]):
//   • match-bet results (exact/outcome/miss) from score_events,
//   • the participant's rank/prize from the latest snapshot,
//   • bonus picks (revealed only after the bonus deadline).
// score_events exist only for finished (usable) results — deadlines long passed —
// so match preds are public; bonus picks are gated by isBonusLocked. The prize is
// computed from the VISUAL position (index+1), matching the table and Sheets
// (leaderboard/page.tsx, sheets.ts both use prizeForPlace(index+1)), NOT the
// dense place which can tie.
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { route, ok, AppError } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { requireParticipant } from "@/lib/auth";
import { db } from "@/db";
import {
  matches,
  participants,
  scoreEvents,
  teams,
  leaderboardSnapshots,
  bonusCategories,
  bonusBets,
  bonusBetItems,
  bonusOutcomes,
} from "@/db/schema";
import { TOURNAMENT_ID } from "@/lib/env";
import { prizeForPlace } from "@/domain/prizes";
import { getTournament, isBonusLocked } from "@/lib/api/tournament";
import { normalizePlayerName } from "@/scoring";
import type { LeaderboardRow } from "@/lib/leaderboard";

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
    .select({ id: participants.id, name: participants.displayName, status: participants.status })
    .from(participants)
    .where(eq(participants.id, id))
    .limit(1);
  if (!part || part.status !== "ACTIVE") {
    throw new AppError(404, "PARTICIPANT_NOT_FOUND", "Participant not found");
  }

  // ---- Match-bet breakdown (from score_events) ----
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
  const matchItems = rows.map((r) => {
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

  // ---- Rank / prize from the latest snapshot (prize by VISUAL position) ----
  const [snapshot] = await db
    .select({ rows: leaderboardSnapshots.rows })
    .from(leaderboardSnapshots)
    .where(eq(leaderboardSnapshots.tournamentId, TOURNAMENT_ID))
    .orderBy(desc(leaderboardSnapshots.generatedAt))
    .limit(1);
  let rank: {
    place: number;
    official_pos: number;
    total_points: number;
    match_points: number;
    bonus_points: number;
    playoff_match_points: number;
    key_bonus_points: number;
    prize: ReturnType<typeof prizeForPlace>;
  } | null = null;
  if (snapshot) {
    const lbRows = snapshot.rows as LeaderboardRow[];
    const idx = lbRows.findIndex((r) => r.participant_id === id);
    if (idx >= 0) {
      const r = lbRows[idx];
      const official_pos = idx + 1; // visual position, matches the table & Sheets
      rank = {
        place: r.place,
        official_pos,
        total_points: r.total_points,
        match_points: r.match_points,
        bonus_points: r.bonus_points,
        playoff_match_points: r.playoff_match_points,
        key_bonus_points: r.key_bonus_points,
        prize: prizeForPlace(official_pos),
      };
    }
  }

  // ---- Bonus picks (revealed only after the bonus deadline) ----
  const t = await getTournament();
  const bonus = isBonusLocked(t) ? await loadBonus(id) : [];

  return ok({
    participant_id: part.id,
    display_name: part.name,
    summary: { exact, outcome: outcomeOnly, miss, no_bet: noBet },
    matches: matchItems,
    rank,
    bonus,
  });
});

interface PickRow {
  bonusBetId: string;
  teamId: string | null;
  playerName: string | null;
  position: number;
  code: string | null;
  nameRu: string | null;
}

/** This participant's bonus picks per category, with server-computed `hit`
 *  (team-id membership / normalized player name) so the highlight matches how
 *  points are actually awarded. Scoped to the current tournament's categories. */
async function loadBonus(participantId: string) {
  const cats = await db
    .select()
    .from(bonusCategories)
    .where(eq(bonusCategories.tournamentId, TOURNAMENT_ID))
    .orderBy(asc(bonusCategories.sortOrder));

  const bets = await db
    .select({ id: bonusBets.id, categoryId: bonusBets.categoryId })
    .from(bonusBets)
    .where(eq(bonusBets.participantId, participantId));
  if (bets.length === 0) return [];
  const betByCat = new Map(bets.map((b) => [b.categoryId, b.id]));

  const itemRows: PickRow[] = await db
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
    .where(inArray(bonusBetItems.bonusBetId, bets.map((b) => b.id)));
  const picksByBet = new Map<string, PickRow[]>();
  for (const it of itemRows) {
    if (!picksByBet.has(it.bonusBetId)) picksByBet.set(it.bonusBetId, []);
    picksByBet.get(it.bonusBetId)!.push(it);
  }

  const outcomeRows = await db
    .select({
      categoryId: bonusOutcomes.categoryId,
      teamId: bonusOutcomes.teamId,
      playerName: bonusOutcomes.playerName,
      code: teams.code,
      nameRu: teams.nameRu,
    })
    .from(bonusOutcomes)
    .leftJoin(teams, eq(teams.id, bonusOutcomes.teamId));
  const actualByCat = new Map<
    string,
    { teamIds: Set<string>; player: string | null; items: Array<{ team_id?: string; code?: string | null; name_ru?: string | null; player_name?: string | null }> }
  >();
  for (const o of outcomeRows) {
    if (!actualByCat.has(o.categoryId)) actualByCat.set(o.categoryId, { teamIds: new Set(), player: null, items: [] });
    const a = actualByCat.get(o.categoryId)!;
    if (o.teamId) {
      a.teamIds.add(o.teamId);
      a.items.push({ team_id: o.teamId, code: o.code, name_ru: o.nameRu });
    } else if (o.playerName) {
      a.player = o.playerName;
      a.items.push({ player_name: o.playerName });
    }
  }

  const scoreRows = await db
    .select({ categoryId: scoreEvents.categoryId, points: scoreEvents.points })
    .from(scoreEvents)
    .where(and(eq(scoreEvents.participantId, participantId), eq(scoreEvents.source, "BONUS")));
  const ptsByCat = new Map<string, number>();
  for (const r of scoreRows) if (r.categoryId) ptsByCat.set(r.categoryId, r.points);

  return cats
    .filter((cat) => (picksByBet.get(betByCat.get(cat.id) ?? "")?.length ?? 0) > 0)
    .map((cat) => {
      const picks = (picksByBet.get(betByCat.get(cat.id)!) ?? []).slice().sort((a, b) => a.position - b.position);
      const actual = actualByCat.get(cat.id);
      const settled = !!actual; // any confirmed outcome → points accrue + are shown
      // Categories settle PARTIALLY: a team is credited the moment it advances,
      // without waiting for the whole stage. Fully `complete` once the actual set
      // reaches its final size — every slot is one team, so that size == item_count
      // (PLAYER / top-scorer is single + manual, so settled == complete there).
      const complete =
        cat.itemType === "PLAYER" ? settled : (actual?.teamIds.size ?? 0) >= cat.itemCount;
      const items = picks.map((p) => {
        const inActual =
          cat.itemType === "PLAYER"
            ? p.playerName != null && actual?.player != null &&
              normalizePlayerName(p.playerName) === normalizePlayerName(actual.player)
            : p.teamId != null && (actual?.teamIds.has(p.teamId) ?? false);
        // true = scored; false = definitively missed (only once complete);
        // null = still pending — the pick can yet advance → neutral chip, not a miss.
        const hit: boolean | null = inActual ? true : complete ? false : null;
        return p.teamId
          ? { team_id: p.teamId, code: p.code, name_ru: p.nameRu, hit }
          : { player_name: p.playerName, hit };
      });
      return {
        category_id: cat.id,
        name_ru: cat.nameRu,
        item_count: cat.itemCount,
        points_per_correct: cat.pointsPerCorrect,
        item_type: cat.itemType as "TEAM" | "PLAYER",
        settled,
        complete,
        points_earned: settled ? (ptsByCat.get(cat.id) ?? 0) : null,
        items,
        actual_items: settled ? actual!.items : null,
      };
    });
}
