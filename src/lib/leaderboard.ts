// Leaderboard assembly: take v_standings rows + per-participant bonus breakdown,
// apply the 4-level tie-break (05 §5) and dense-rank places (06 §3.11), and
// attach top-5 prizes (FR-17). Pure given its inputs, so it is easy to test.
import { compareStandings, type Standing } from "@/scoring";
import { BONUS_CATEGORIES } from "@/domain/bonus";
import { prizeForPlace, type Prize } from "@/domain/prizes";

export interface StandingRow {
  participantId: string;
  displayName: string;
  totalPoints: number;
  matchPoints: number;
  bonusPoints: number;
  playoffMatchPoints: number;
  keyBonusPoints: number;
  tiebreakRank: number | null;
}

export interface LeaderboardRow {
  place: number;
  participant_id: string;
  display_name: string;
  total_points: number;
  match_points: number;
  bonus_points: number;
  playoff_match_points: number;
  key_bonus_points: number;
  tiebreak_rank: number | null;
  bonus_breakdown: Record<string, number | null>;
  prize: Prize | null;
}

const CATEGORY_IDS = BONUS_CATEGORIES.map((c) => c.id);

/** Two rows share a place iff equal on every *meaningful* criterion (not id). */
function tiedForPlace(a: StandingRow, b: StandingRow): boolean {
  return (
    a.totalPoints === b.totalPoints &&
    a.playoffMatchPoints === b.playoffMatchPoints &&
    a.keyBonusPoints === b.keyBonusPoints &&
    (a.tiebreakRank ?? null) === (b.tiebreakRank ?? null)
  );
}

export function buildLeaderboardRows(
  standings: StandingRow[],
  bonusByParticipant: Map<string, Map<string, number>>,
  settledCategories: Set<string>,
): LeaderboardRow[] {
  // Within a tie group (same place) order alphabetically — before any results
  // land everyone is tied, and an id-ordered list reads as random to users.
  const sorted = [...standings].sort((a, b) =>
    tiedForPlace(a, b)
      ? a.displayName.localeCompare(b.displayName, "ru")
      : compareStandings(toStanding(a), toStanding(b)),
  );

  const rows: LeaderboardRow[] = [];
  let place = 0;
  let prev: StandingRow | null = null;

  for (const s of sorted) {
    if (!prev || !tiedForPlace(s, prev)) place += 1; // dense rank
    prev = s;

    const earned = bonusByParticipant.get(s.participantId) ?? new Map<string, number>();
    const breakdown: Record<string, number | null> = {};
    for (const cid of CATEGORY_IDS) {
      breakdown[cid] = settledCategories.has(cid) ? (earned.get(cid) ?? 0) : null;
    }

    rows.push({
      place,
      participant_id: s.participantId,
      display_name: s.displayName,
      total_points: s.totalPoints,
      match_points: s.matchPoints,
      bonus_points: s.bonusPoints,
      playoff_match_points: s.playoffMatchPoints,
      key_bonus_points: s.keyBonusPoints,
      tiebreak_rank: s.tiebreakRank,
      bonus_breakdown: breakdown,
      prize: prizeForPlace(place),
    });
  }

  return rows;
}

function toStanding(s: StandingRow): Standing {
  return {
    participantId: s.participantId,
    total: s.totalPoints,
    playoffMatch: s.playoffMatchPoints,
    keyBonus: s.keyBonusPoints,
    tiebreakRank: s.tiebreakRank,
  };
}
