// Leaderboard comparator implementing the four-level tie-break (00 §2.4 / 05 §5),
// highest place first. The id fallback keeps rendering deterministic so the
// table never flickers.

export interface Standing {
  participantId: string;
  total: number; // total_points
  playoffMatch: number; // play-off (R32..FINAL) match-bet points
  keyBonus: number; // QF_PARTICIPANT + SF_PARTICIPANT + FINALIST + CHAMPION
  tiebreakRank: number | null; // manual "по росту" order; lower = higher place
}

export function compareStandings(a: Standing, b: Standing): number {
  if (a.total !== b.total) return b.total - a.total; // 1) total ↓
  if (a.playoffMatch !== b.playoffMatch) return b.playoffMatch - a.playoffMatch; // 2) play-off match ↓
  if (a.keyBonus !== b.keyBonus) return b.keyBonus - a.keyBonus; // 3) key bonus ↓
  const ar = a.tiebreakRank ?? Number.POSITIVE_INFINITY; // 4) "по росту :)"
  const br = b.tiebreakRank ?? Number.POSITIVE_INFINITY;
  if (ar !== br) return ar - br;
  return a.participantId.localeCompare(b.participantId); // stable fallback
}
