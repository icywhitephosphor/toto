import { describe, it, expect } from "vitest";
import { computeLiveOverlay, isProvisionalMatch, type LiveMatchInfo } from "./liveOverlay";
import type { Stage } from "@/scoring";
import type { LeaderboardRow } from "./leaderboard";

const row = (id: string, name: string, total: number, over: Partial<LeaderboardRow> = {}): LeaderboardRow => ({
  place: 1,
  participant_id: id,
  display_name: name,
  total_points: total,
  match_points: total,
  bonus_points: 0,
  playoff_match_points: 0,
  key_bonus_points: 0,
  tiebreak_rank: null,
  bonus_breakdown: {},
  prize: null,
  ...over,
});

const liveGroup: LiveMatchInfo = {
  match_id: "m1",
  fifa_match_no: 3,
  stage: "GROUP",
  home: { code: "CAN", name_ru: "Канада" },
  away: { code: "BIH", name_ru: "Босния и Герцеговина" },
  score: [0, 1],
  status: "LIVE",
};

describe("computeLiveOverlay", () => {
  it("is inactive without provisional matches", () => {
    expect(computeLiveOverlay([row("a", "А", 0)], [], []).active).toBe(false);
  });

  it("scores outcome=1 / exact=2 for a live group match and re-ranks with move counts", () => {
    const official = [row("a", "Андрей", 3), row("b", "Борис", 3), row("c", "Вася", 2)];
    const bets = [
      { participantId: "c", matchId: "m1", predHome: 0, predAway: 1, x2: false }, // exact → +2
      { participantId: "b", matchId: "m1", predHome: 1, predAway: 2, x2: false }, // outcome → +1
      { participantId: "a", matchId: "m1", predHome: 2, predAway: 0, x2: false }, // miss → 0
    ];
    const live = computeLiveOverlay(official, [liveGroup], bets);
    expect(live.active).toBe(true);
    const by = new Map(live.rows.map((r) => [r.participant_id, r]));
    // c and b tie at 4 → alphabetical inside the tie («Борис» < «Вася»), the
    // same rule the official table uses.
    expect(by.get("b")).toMatchObject({ delta: 1, live_total: 4, live_pos: 1, official_pos: 2, moves: 1 });
    expect(by.get("c")).toMatchObject({ delta: 2, live_total: 4, live_pos: 2, official_pos: 3, moves: 1 });
    expect(by.get("a")).toMatchObject({ delta: 0, live_total: 3, live_pos: 3, official_pos: 1, moves: -2 });
  });

  it("applies the ×2 penalty on a play-off miss and feeds the play-off tie-break", () => {
    const ko: LiveMatchInfo = { ...liveGroup, match_id: "m2", fifa_match_no: 90, stage: "R16", score: [2, 0] };
    const official = [row("a", "Андрей", 5), row("b", "Борис", 5)];
    const bets = [
      { participantId: "a", matchId: "m2", predHome: 0, predAway: 1, x2: true }, // miss both ×2 → −4 (R16 exact=4)
      { participantId: "b", matchId: "m2", predHome: 2, predAway: 0, x2: true }, // exact ×2 → +8
    ];
    const live = computeLiveOverlay(official, [ko], bets);
    const by = new Map(live.rows.map((r) => [r.participant_id, r]));
    expect(by.get("a")!.delta).toBe(-4);
    expect(by.get("b")!.delta).toBe(8);
    expect(by.get("b")!.live_pos).toBe(1);
    expect(by.get("a")!.moves).toBe(-1);
    expect(by.get("b")!.moves).toBe(1);
  });

  it("keeps alphabetical order inside untouched tie groups", () => {
    const official = [row("b", "Борис", 1), row("v", "Вася", 1), row("g", "Гриша", 1)];
    const live = computeLiveOverlay(official, [liveGroup], [
      { participantId: "g", matchId: "m1", predHome: 0, predAway: 1, x2: false }, // +2 → top
    ]);
    expect(live.rows.find((r) => r.participant_id === "g")!.live_pos).toBe(1);
    expect(live.rows.find((r) => r.participant_id === "b")!.live_pos).toBe(2);
    expect(live.rows.find((r) => r.participant_id === "v")!.live_pos).toBe(3);
  });

  it("a no-bet participant gets delta 0 and an empty contribs list", () => {
    const live = computeLiveOverlay([row("a", "А", 0)], [liveGroup], []);
    expect(live.rows[0]).toMatchObject({ delta: 0, contribs: [], moves: 0 });
  });
});

// The provisional set is the exact complement of recompute's `usable` filter.
// This logic lives in loadLiveBlock's row loop; isProvisionalMatch is its pure,
// clock-free core (the deadline-visibility guard is a separate query filter).
describe("isProvisionalMatch", () => {
  const base = { stage: "GROUP" as Stage, confirmed: false, totoHome: 1, totoAway: 0 };

  it("includes a LIVE in-play row", () => {
    expect(isProvisionalMatch({ ...base, resultStatus: "LIVE" })).toBe(true);
  });

  it("includes an unconfirmed play-off final (awaiting admin confirm)", () => {
    expect(isProvisionalMatch({ ...base, stage: "R16", resultStatus: "FT", confirmed: false })).toBe(true);
    expect(isProvisionalMatch({ ...base, stage: "FINAL", resultStatus: "PEN", confirmed: false })).toBe(true);
  });

  it("excludes a confirmed play-off final (already official)", () => {
    expect(isProvisionalMatch({ ...base, stage: "R16", resultStatus: "FT", confirmed: true })).toBe(false);
  });

  it("excludes a group final (auto-confirmed → already official)", () => {
    expect(isProvisionalMatch({ ...base, stage: "GROUP", resultStatus: "FT", confirmed: false })).toBe(false);
  });

  it("excludes non-live, non-final statuses (CANCELLED, SCHEDULED, …)", () => {
    expect(isProvisionalMatch({ ...base, resultStatus: "CANCELLED" })).toBe(false);
    expect(isProvisionalMatch({ ...base, resultStatus: "SCHEDULED" })).toBe(false);
  });

  it("excludes any row without a toto score", () => {
    expect(isProvisionalMatch({ ...base, resultStatus: "LIVE", totoHome: null, totoAway: null })).toBe(false);
    expect(isProvisionalMatch({ ...base, stage: "R16", resultStatus: "FT", totoHome: null, totoAway: 2 })).toBe(false);
  });
});
