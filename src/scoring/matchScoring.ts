// Match-bet scoring. Implements 01 §6.1 exactly: score and outcome points never
// stack; ×2 only in play-offs; missing both with ×2 subtracts the UN-doubled
// exact-score points. The single source of match points.

import { MATCH_POINTS, outcome, type Stage } from "./types";
import type { TotoScore } from "./totoScore";

export interface MatchBet {
  predHome: number;
  predAway: number;
  x2: boolean;
}

/** Points for one match bet against the canonical toto score. No bet → 0 (FR-14). */
export function scoreMatchBet(
  stage: Stage,
  bet: MatchBet | null,
  toto: TotoScore,
): number {
  if (!bet) return 0; // no bet → 0 points, never a penalty
  const rule = MATCH_POINTS[stage];
  const x2 = bet.x2 && rule.x2Allowed; // ×2 silently ignored where disallowed
  const exact = bet.predHome === toto.home && bet.predAway === toto.away;
  const rightOutcome =
    outcome(bet.predHome, bet.predAway) === outcome(toto.home, toto.away);

  if (exact) return x2 ? rule.exact * 2 : rule.exact;
  if (rightOutcome) return x2 ? rule.outcome * 2 : rule.outcome;
  return x2 ? -rule.exact : 0; // miss both: ×2 → −exact (un-doubled), else 0
}

/**
 * Open question 01 §7.3, default (b): a play-off bet is entered as a regulation
 * score plus a shootout winner pick. Derive the decisive predicted score so
 * scoreMatchBet needs no special case. Store the derived pred_home/pred_away in
 * match_bets (plus pen_winner for display).
 */
export interface RawMatchBet {
  predHome: number;
  predAway: number;
  x2?: boolean;
  penWinner?: "HOME" | "AWAY";
}

export function derivePlayoffBet(b: RawMatchBet): MatchBet {
  const x2 = b.x2 ?? false;
  if (b.predHome === b.predAway && b.penWinner) {
    return b.penWinner === "HOME"
      ? { predHome: b.predHome + 1, predAway: b.predAway, x2 }
      : { predHome: b.predHome, predAway: b.predAway + 1, x2 };
  }
  return { predHome: b.predHome, predAway: b.predAway, x2 };
}
