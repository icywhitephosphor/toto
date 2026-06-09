// Canonical play-off ("toto") score: fold the penalty shootout into a "+1 goal"
// for the winner so the toto score is always decisive (architecture/05 §2).
// Example: ET 2:2, pens 5:3 → toto 3:2.

export interface RawResult {
  baseHome: number; // goals after regulation (+ extra time for play-offs)
  baseAway: number;
  penHome?: number | null; // shootout score, null/undefined if no shootout
  penAway?: number | null;
}

export interface TotoScore {
  home: number;
  away: number;
}

export function totoScore(r: RawResult): TotoScore {
  const hadShootout =
    r.penHome != null && r.penAway != null && r.penHome !== r.penAway;
  if (hadShootout) {
    return r.penHome! > r.penAway!
      ? { home: r.baseHome + 1, away: r.baseAway }
      : { home: r.baseHome, away: r.baseAway + 1 };
  }
  // Group matches (no shootout fields) → toto = base, draws allowed.
  return { home: r.baseHome, away: r.baseAway };
}
