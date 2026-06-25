import { describe, it, expect } from "vitest";
import { deriveBonusOutcomes, type DeriveMatch, type Derivation } from "./deriveOutcomes";

// --- fixtures -------------------------------------------------------------

const gm = (
  groupCode: string,
  h: string,
  a: string,
  hg: number,
  ag: number,
  usable = true,
): DeriveMatch => ({
  stage: "GROUP",
  groupCode,
  homeTeamId: h,
  awayTeamId: a,
  totoHome: usable ? hg : null,
  totoAway: usable ? ag : null,
  winnerTeamId: null,
  usable,
});

const km = (stage: string, winner: string, loser: string, usable = true): DeriveMatch => ({
  stage,
  groupCode: null,
  homeTeamId: winner,
  awayTeamId: loser,
  totoHome: usable ? 1 : null,
  totoAway: usable ? 0 : null,
  winnerTeamId: usable ? winner : null,
  usable,
});

const stage = (s: string, n: number, allUsable = true): DeriveMatch[] =>
  Array.from({ length: n }, (_, i) => km(s, `${s}_w${i}`, `${s}_l${i}`, allUsable));

const get = (ds: Derivation[], id: string): Derivation => ds.find((d) => d.categoryId === id)!;

// --- GROUP_WINNER ---------------------------------------------------------

describe("deriveBonusOutcomes — GROUP_WINNER", () => {
  it("picks the clear points leader", () => {
    // a1 wins all three → 9 pts.
    const games = [
      gm("A", "a1", "a2", 1, 0),
      gm("A", "a1", "a3", 1, 0),
      gm("A", "a1", "a4", 1, 0),
      gm("A", "a2", "a3", 0, 0),
      gm("A", "a2", "a4", 0, 0),
      gm("A", "a3", "a4", 0, 0),
    ];
    const d = get(deriveBonusOutcomes(games), "GROUP_WINNER");
    expect(d.ready).toBe(true);
    expect(d.teamIds).toEqual(["a1"]);
  });

  it("breaks an equal-points tie on goal difference", () => {
    // a1 & a2 both 7 pts (draw each other, beat a3/a4); a1 has the bigger GD.
    const games = [
      gm("A", "a1", "a2", 1, 1),
      gm("A", "a1", "a3", 5, 0),
      gm("A", "a1", "a4", 5, 0),
      gm("A", "a2", "a3", 2, 0),
      gm("A", "a2", "a4", 2, 0),
      gm("A", "a3", "a4", 0, 0),
    ];
    const d = get(deriveBonusOutcomes(games), "GROUP_WINNER");
    expect(d.teamIds).toEqual(["a1"]);
  });

  it("breaks a points+GD+GF tie on head-to-head", () => {
    // b1 & b2 both 6 pts, GD +1, GF 3 — identical overall; b1 won the head-to-head.
    const games = [
      gm("B", "b1", "b2", 2, 1),
      gm("B", "b1", "b3", 1, 0),
      gm("B", "b4", "b1", 1, 0),
      gm("B", "b2", "b3", 1, 0),
      gm("B", "b2", "b4", 1, 0),
      gm("B", "b3", "b4", 1, 0),
    ];
    const d = get(deriveBonusOutcomes(games), "GROUP_WINNER");
    expect(d.ready).toBe(true);
    expect(d.teamIds).toEqual(["b1"]);
  });

  it("defers a genuine dead tie (3-way cycle) to a manual settle", () => {
    // c1>c2>c3>c1, all beat c4: identical on points/GD/GF AND head-to-head.
    const games = [
      gm("C", "c1", "c4", 1, 0),
      gm("C", "c2", "c4", 1, 0),
      gm("C", "c3", "c4", 1, 0),
      gm("C", "c1", "c2", 1, 0),
      gm("C", "c2", "c3", 1, 0),
      gm("C", "c3", "c1", 1, 0),
    ];
    const d = get(deriveBonusOutcomes(games), "GROUP_WINNER");
    expect(d.ready).toBe(true);
    expect(d.teamIds).toBeNull();
    expect(d.ambiguousGroups).toEqual(["C"]);
  });

  it("is not ready while any group match is unplayed", () => {
    const games = [
      gm("A", "a1", "a2", 1, 0),
      gm("A", "a1", "a3", 1, 0),
      gm("A", "a1", "a4", 1, 0),
      gm("A", "a2", "a3", 0, 0),
      gm("A", "a2", "a4", 0, 0),
      gm("A", "a3", "a4", 0, 0, false), // not yet played
    ];
    const d = get(deriveBonusOutcomes(games), "GROUP_WINNER");
    expect(d.ready).toBe(false);
    expect(d.teamIds).toBeNull();
  });

  it("returns multiple group winners sorted by group code", () => {
    const games = [
      ...[
        gm("A", "a1", "a2", 3, 0),
        gm("A", "a1", "a3", 3, 0),
        gm("A", "a1", "a4", 3, 0),
        gm("A", "a2", "a3", 0, 0),
        gm("A", "a2", "a4", 0, 0),
        gm("A", "a3", "a4", 0, 0),
      ],
      ...[
        gm("B", "b1", "b2", 3, 0),
        gm("B", "b1", "b3", 3, 0),
        gm("B", "b1", "b4", 3, 0),
        gm("B", "b2", "b3", 0, 0),
        gm("B", "b2", "b4", 0, 0),
        gm("B", "b3", "b4", 0, 0),
      ],
    ];
    const d = get(deriveBonusOutcomes(games), "GROUP_WINNER");
    expect(d.teamIds).toEqual(["a1", "b1"]);
  });
});

// --- knockout participant categories --------------------------------------

describe("deriveBonusOutcomes — knockout winners", () => {
  it("derives R16 participants from the 16 R32 winners", () => {
    const d = get(deriveBonusOutcomes(stage("R32", 16)), "R16_PARTICIPANT");
    expect(d.ready).toBe(true);
    expect(d.teamIds).toHaveLength(16);
    expect(d.teamIds).toEqual(Array.from({ length: 16 }, (_, i) => `R32_w${i}`));
  });

  it("is not ready until every match of the stage is usable", () => {
    const ms = stage("R32", 16);
    ms[5] = km("R32", "R32_w5", "R32_l5", false); // one still in play
    const d = get(deriveBonusOutcomes(ms), "R16_PARTICIPANT");
    expect(d.ready).toBe(false);
    expect(d.teamIds).toBeNull();
  });

  it("is not ready when the stage is short a match", () => {
    const d = get(deriveBonusOutcomes(stage("R16", 7)), "QF_PARTICIPANT");
    expect(d.ready).toBe(false);
  });

  it("derives the champion from the final", () => {
    const d = get(deriveBonusOutcomes([km("FINAL", "winner", "runnerup")]), "CHAMPION");
    expect(d.ready).toBe(true);
    expect(d.teamIds).toEqual(["winner"]);
  });

  it("does not emit a TOP_SCORER derivation (not auto-derivable)", () => {
    expect(deriveBonusOutcomes(stage("FINAL", 1)).find((d) => d.categoryId === "TOP_SCORER")).toBeUndefined();
  });
});
