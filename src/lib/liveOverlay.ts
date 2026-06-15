// Live leaderboard overlay: provisional points from matches whose score is
// known but NOT officially counted yet — in-play (result_status = LIVE) and
// unconfirmed play-off finals. Read-only, computed per request; never touches
// score_events/snapshots, so the money path stays exactly as it is. The
// provisional set is the complement of recompute's `usable` filter, so a point
// can never be counted twice.
import { and, eq, inArray, isNotNull, lte } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { matches, matchResults, matchBets, teams } from "@/db/schema";
import { TOURNAMENT_ID } from "@/lib/env";
import { scoreMatchBet, type Stage } from "@/scoring";
import { orderStandings, type StandingRow } from "@/lib/leaderboard";
import type { LeaderboardRow } from "@/lib/leaderboard";

export interface LiveMatchInfo {
  match_id: string;
  fifa_match_no: number;
  stage: Stage;
  home: { code: string | null; name_ru: string | null };
  away: { code: string | null; name_ru: string | null };
  score: [number, number];
  status: "LIVE" | "AWAITING_CONFIRM";
}

export interface LiveContrib {
  match_id: string;
  fifa_match_no: number;
  pred: [number, number];
  x2: boolean;
  points: number;
}

export interface LiveRow {
  participant_id: string;
  delta: number;
  live_total: number;
  live_pos: number;
  official_pos: number;
  /** positive = moved up N positions vs the official table, negative = down. */
  moves: number;
  contribs: LiveContrib[];
}

export interface LiveBlock {
  active: boolean;
  matches: LiveMatchInfo[];
  rows: LiveRow[];
}

interface ProvisionalBet {
  participantId: string;
  matchId: string;
  predHome: number;
  predAway: number;
  x2: boolean;
}

/** Pure: official rows + provisional matches + their bets → the live block. */
export function computeLiveOverlay(
  official: LeaderboardRow[],
  liveMatches: LiveMatchInfo[],
  bets: ProvisionalBet[],
): LiveBlock {
  if (liveMatches.length === 0) return { active: false, matches: [], rows: [] };

  const matchById = new Map(liveMatches.map((m) => [m.match_id, m]));
  const contribsByPart = new Map<string, LiveContrib[]>();
  for (const b of bets) {
    const m = matchById.get(b.matchId);
    if (!m) continue;
    const points = scoreMatchBet(
      m.stage,
      { predHome: b.predHome, predAway: b.predAway, x2: b.x2 },
      { home: m.score[0], away: m.score[1] },
    );
    if (!contribsByPart.has(b.participantId)) contribsByPart.set(b.participantId, []);
    contribsByPart.get(b.participantId)!.push({
      match_id: m.match_id,
      fifa_match_no: m.fifa_match_no,
      pred: [b.predHome, b.predAway],
      x2: b.x2,
      points,
    });
  }

  // Provisional standings: same fields the official comparator uses, with the
  // deltas applied (play-off deltas also feed the play-off tie-break level).
  const provisional: StandingRow[] = official.map((r) => {
    const contribs = contribsByPart.get(r.participant_id) ?? [];
    const delta = contribs.reduce((s, c) => s + c.points, 0);
    const playoffDelta = contribs.reduce((s, c) => {
      const m = matchById.get(c.match_id);
      return s + (m && m.stage !== "GROUP" ? c.points : 0);
    }, 0);
    return {
      participantId: r.participant_id,
      displayName: r.display_name,
      totalPoints: r.total_points + delta,
      matchPoints: r.match_points + delta,
      bonusPoints: r.bonus_points,
      playoffMatchPoints: r.playoff_match_points + playoffDelta,
      keyBonusPoints: r.key_bonus_points,
      tiebreakRank: r.tiebreak_rank,
    };
  });

  const ordered = orderStandings(provisional);
  const livePosById = new Map(ordered.map((s, i) => [s.participantId, i + 1]));
  const officialPosById = new Map(official.map((r, i) => [r.participant_id, i + 1]));

  const rows: LiveRow[] = official.map((r) => {
    const contribs = (contribsByPart.get(r.participant_id) ?? []).sort(
      (a, b) => a.fifa_match_no - b.fifa_match_no,
    );
    const delta = contribs.reduce((s, c) => s + c.points, 0);
    const official_pos = officialPosById.get(r.participant_id)!;
    const live_pos = livePosById.get(r.participant_id)!;
    return {
      participant_id: r.participant_id,
      delta,
      live_total: r.total_points + delta,
      live_pos,
      official_pos,
      moves: official_pos - live_pos,
      contribs,
    };
  });

  return { active: true, matches: liveMatches, rows };
}

const FINAL_STATUSES = ["FT", "AET", "PEN"];

export interface ProvisionalCandidate {
  resultStatus: string;
  stage: Stage;
  confirmed: boolean;
  totoHome: number | null;
  totoAway: number | null;
}

/**
 * True iff this result row contributes *provisional* (not-yet-official) points:
 * it has a toto score AND is the exact complement of recompute's `usable`
 * filter — an in-play LIVE row, or a final whose stage still needs admin
 * confirmation (play-off). Pure (no clock); the deadline-visibility guard lives
 * in the loader query, so a row can never be counted both here and officially.
 */
export function isProvisionalMatch(m: ProvisionalCandidate): boolean {
  if (m.totoHome == null || m.totoAway == null) return false;
  if (FINAL_STATUSES.includes(m.resultStatus)) {
    // A final is official once GROUP, or once an admin confirms a play-off;
    // provisional = the still-unconfirmed play-off final.
    return m.stage !== "GROUP" && !m.confirmed;
  }
  return m.resultStatus === "LIVE";
}

const homeTeam = alias(teams, "lv_home");
const awayTeam = alias(teams, "lv_away");

/** Load the provisional match set + its bets and compute the overlay. */
export async function loadLiveBlock(official: LeaderboardRow[]): Promise<LiveBlock> {
  // Defence in depth: this endpoint is public and exposes each participant's
  // pick, so only ever consider matches whose deadline has already passed (bets
  // are revealed only then). In normal flow a LIVE row already implies the
  // deadline is long gone (it = kickoff − 3h), but we must not leak a pick if a
  // bad/manual result row ever lands before its deadline.
  const now = new Date();
  const rows = await db
    .select({
      matchId: matches.id,
      no: matches.fifaMatchNo,
      stage: matches.stage,
      homeCode: homeTeam.code,
      homeName: homeTeam.nameRu,
      awayCode: awayTeam.code,
      awayName: awayTeam.nameRu,
      resultStatus: matchResults.resultStatus,
      confirmed: matchResults.confirmed,
      totoHome: matchResults.totoHome,
      totoAway: matchResults.totoAway,
    })
    .from(matchResults)
    .innerJoin(matches, eq(matches.id, matchResults.matchId))
    .leftJoin(homeTeam, eq(homeTeam.id, matches.homeTeamId))
    .leftJoin(awayTeam, eq(awayTeam.id, matches.awayTeamId))
    .where(
      and(
        eq(matches.tournamentId, TOURNAMENT_ID),
        isNotNull(matchResults.totoHome),
        isNotNull(matchResults.totoAway),
        lte(matches.deadlineAt, now), // never expose picks before the deadline
      ),
    );

  const liveMatches: LiveMatchInfo[] = [];
  for (const r of rows) {
    if (
      !isProvisionalMatch({
        resultStatus: r.resultStatus,
        stage: r.stage as Stage,
        confirmed: r.confirmed,
        totoHome: r.totoHome,
        totoAway: r.totoAway,
      })
    )
      continue;
    liveMatches.push({
      match_id: r.matchId,
      fifa_match_no: r.no,
      stage: r.stage as Stage,
      home: { code: r.homeCode, name_ru: r.homeName },
      away: { code: r.awayCode, name_ru: r.awayName },
      score: [r.totoHome!, r.totoAway!],
      status: r.resultStatus === "LIVE" ? "LIVE" : "AWAITING_CONFIRM",
    });
  }
  if (liveMatches.length === 0) return { active: false, matches: [], rows: [] };

  const bets = await db
    .select({
      participantId: matchBets.participantId,
      matchId: matchBets.matchId,
      predHome: matchBets.predHome,
      predAway: matchBets.predAway,
      x2: matchBets.x2,
    })
    .from(matchBets)
    .where(inArray(matchBets.matchId, liveMatches.map((m) => m.match_id)));

  return computeLiveOverlay(official, liveMatches, bets);
}
