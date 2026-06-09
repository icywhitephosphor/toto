// Core scoring types and constants. Pure data — no I/O, no clock, no DB.
// Mirrors architecture/05 §1 exactly. The engine is the single source of points.

export type Stage = "GROUP" | "R32" | "R16" | "QF" | "SF" | "THIRD" | "FINAL";
export type Outcome = "HOME" | "DRAW" | "AWAY";

/** Per-stage points and whether the ×2 stake is allowed (play-offs only). */
export const MATCH_POINTS: Record<
  Stage,
  { exact: number; outcome: number; x2Allowed: boolean }
> = {
  GROUP: { exact: 2, outcome: 1, x2Allowed: false },
  R32: { exact: 3, outcome: 2, x2Allowed: true },
  R16: { exact: 4, outcome: 3, x2Allowed: true },
  QF: { exact: 5, outcome: 4, x2Allowed: true },
  SF: { exact: 7, outcome: 5, x2Allowed: true },
  THIRD: { exact: 7, outcome: 5, x2Allowed: true },
  FINAL: { exact: 10, outcome: 7, x2Allowed: true },
};

export const PLAYOFF_STAGES: Stage[] = ["R32", "R16", "QF", "SF", "THIRD", "FINAL"];

/** Bonus categories settle only once their trigger stage is complete (05 §4). */
export const BONUS_SETTLES_AFTER: Record<string, Stage> = {
  GROUP_WINNER: "GROUP",
  R16_PARTICIPANT: "R32", // 16 teams that REACH R16 = winners of matches 73–88
  QF_PARTICIPANT: "R16",
  SF_PARTICIPANT: "QF",
  FINALIST: "SF",
  CHAMPION: "FINAL",
  TOP_SCORER: "FINAL",
};

/** Key bonus categories used in tie-break level 3 (00 §2.4). */
export const KEY_BONUS_CATEGORIES = [
  "QF_PARTICIPANT",
  "SF_PARTICIPANT",
  "FINALIST",
  "CHAMPION",
] as const;

export const outcome = (h: number, a: number): Outcome =>
  h > a ? "HOME" : h < a ? "AWAY" : "DRAW";
