import { describe, it, expect } from "vitest";
import {
  scoreMatchBet,
  totoScore,
  derivePlayoffBet,
  scoreBonusTeams,
  scoreTopScorer,
  compareStandings,
  type Stage,
  type MatchBet,
  type RawResult,
  type Standing,
} from "./index";

// The nine worked examples from the rules sheet (01 §6.5 / 05 §6).
// [name, stage, bet, rawResult, expected]
const cases: Array<[string, Stage, MatchBet, RawResult, number]> = [
  ["group: outcome only", "GROUP", { predHome: 0, predAway: 4, x2: false }, { baseHome: 0, baseAway: 3 }, 1],
  ["R32: outcome ×2", "R32", { predHome: 2, predAway: 1, x2: true }, { baseHome: 3, baseAway: 1 }, 4],
  ["R16: miss both ×2 (−)", "R16", { predHome: 0, predAway: 2, x2: true }, { baseHome: 1, baseAway: 0 }, -4],
  ["R16: outcome ×2", "R16", { predHome: 2, predAway: 0, x2: true }, { baseHome: 1, baseAway: 0 }, 6],
  ["R16: exact ×2", "R16", { predHome: 1, predAway: 0, x2: true }, { baseHome: 1, baseAway: 0 }, 8],
  ["QF: wrong, no ×2", "QF", { predHome: 2, predAway: 1, x2: false }, { baseHome: 1, baseAway: 2 }, 0],
  ["SF: exact ×2", "SF", { predHome: 2, predAway: 1, x2: true }, { baseHome: 2, baseAway: 1 }, 14],
  ["FINAL: exact ×2", "FINAL", { predHome: 0, predAway: 3, x2: true }, { baseHome: 0, baseAway: 3 }, 20],
  ["FINAL: miss both ×2 (−)", "FINAL", { predHome: 2, predAway: 1, x2: true }, { baseHome: 0, baseAway: 3 }, -10],
];

describe("scoreMatchBet — rules-sheet worked examples", () => {
  for (const [name, stage, bet, raw, expected] of cases) {
    it(name, () => expect(scoreMatchBet(stage, bet, totoScore(raw))).toBe(expected));
  }
});

describe("totoScore — canonical penalty score", () => {
  it("ET 2:2, pens 5:3 → toto 3:2", () =>
    expect(totoScore({ baseHome: 2, baseAway: 2, penHome: 5, penAway: 3 })).toEqual({
      home: 3,
      away: 2,
    }));

  it("ET 1:1, pens 3:4 → toto 1:2", () =>
    expect(totoScore({ baseHome: 1, baseAway: 1, penHome: 3, penAway: 4 })).toEqual({
      home: 1,
      away: 2,
    }));

  it("regulation win, no shootout → toto = base", () =>
    expect(totoScore({ baseHome: 2, baseAway: 0 })).toEqual({ home: 2, away: 0 }));
});

describe("scoreMatchBet — defensive edge cases", () => {
  it("group ignores ×2", () =>
    expect(scoreMatchBet("GROUP", { predHome: 1, predAway: 0, x2: true }, { home: 1, away: 0 })).toBe(2));

  it("no bet → 0", () =>
    expect(scoreMatchBet("FINAL", null, { home: 1, away: 0 })).toBe(0));

  it("play-off predicted draw loses outcome (decisive toto)", () =>
    expect(scoreMatchBet("R16", { predHome: 1, predAway: 1, x2: false }, { home: 2, away: 1 })).toBe(0));
});

describe("derivePlayoffBet — draw + penalty-winner entry (01 §7.3 default b)", () => {
  it("draw decided on pens for HOME → +1 home", () =>
    expect(derivePlayoffBet({ predHome: 1, predAway: 1, penWinner: "HOME", x2: true })).toEqual({
      predHome: 2,
      predAway: 1,
      x2: true,
    }));

  it("draw decided on pens for AWAY → +1 away", () =>
    expect(derivePlayoffBet({ predHome: 0, predAway: 0, penWinner: "AWAY" })).toEqual({
      predHome: 0,
      predAway: 1,
      x2: false,
    }));

  it("decisive regulation score passes through untouched", () =>
    expect(derivePlayoffBet({ predHome: 2, predAway: 1, penWinner: "AWAY" })).toEqual({
      predHome: 2,
      predAway: 1,
      x2: false,
    }));
});

describe("scoreBonusTeams — set intersection × points", () => {
  it("counts only correct picks", () =>
    expect(scoreBonusTeams(new Set(["a", "b", "c"]), new Set(["b", "c", "d"]), 2)).toBe(4));

  it("no overlap → 0", () =>
    expect(scoreBonusTeams(new Set(["x"]), new Set(["y"]), 5)).toBe(0));
});

describe("scoreTopScorer — single official player", () => {
  it("case/space-insensitive match", () =>
    expect(scoreTopScorer("  Kylian Mbappé ", "kylian mbappé", 7)).toBe(7));
  it("wrong player → 0", () => expect(scoreTopScorer("Messi", "Mbappé", 7)).toBe(0));
  it("not settled yet → 0", () => expect(scoreTopScorer("Messi", null, 7)).toBe(0));
});

describe("compareStandings — four-level tie-break", () => {
  const mk = (o: Partial<Standing> & { participantId: string }): Standing => ({
    total: 0,
    playoffMatch: 0,
    keyBonus: 0,
    tiebreakRank: null,
    ...o,
  });

  it("orders by total desc first", () => {
    const rows = [mk({ participantId: "a", total: 10 }), mk({ participantId: "b", total: 20 })];
    rows.sort(compareStandings);
    expect(rows.map((r) => r.participantId)).toEqual(["b", "a"]);
  });

  it("breaks ties by play-off match, then key bonus, then manual rank", () => {
    const rows = [
      mk({ participantId: "a", total: 30, playoffMatch: 5, keyBonus: 2, tiebreakRank: 2 }),
      mk({ participantId: "b", total: 30, playoffMatch: 5, keyBonus: 2, tiebreakRank: 1 }),
      mk({ participantId: "c", total: 30, playoffMatch: 8 }),
      mk({ participantId: "d", total: 30, playoffMatch: 5, keyBonus: 9 }),
    ];
    rows.sort(compareStandings);
    expect(rows.map((r) => r.participantId)).toEqual(["c", "d", "b", "a"]);
  });

  it("is deterministic on a genuine tie (id fallback)", () => {
    const rows = [mk({ participantId: "z", total: 5 }), mk({ participantId: "a", total: 5 })];
    rows.sort(compareStandings);
    expect(rows.map((r) => r.participantId)).toEqual(["a", "z"]);
  });
});
