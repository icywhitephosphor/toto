import { describe, it, expect } from "vitest";
import { fdCode, mapFinishedScore, type FdMatch } from "./footballData";

const base = (over: Partial<FdMatch> & { score: FdMatch["score"] }): FdMatch => ({
  id: 1,
  utcDate: "2026-06-11T19:00:00Z",
  status: "FINISHED",
  stage: "GROUP_STAGE",
  group: "GROUP_A",
  homeTeam: { id: 1, name: "Mexico", tla: "MEX" },
  awayTeam: { id: 2, name: "South Africa", tla: "RSA" },
  ...over,
});

describe("fdCode", () => {
  it("maps FD's URY to our URU and passes the rest through", () => {
    expect(fdCode("URY")).toBe("URU");
    expect(fdCode("MEX")).toBe("MEX");
    expect(fdCode(null)).toBeNull();
  });
});

describe("mapFinishedScore", () => {
  it("maps a regular-time result", () => {
    const m = base({ score: { winner: "HOME_TEAM", duration: "REGULAR", fullTime: { home: 3, away: 1 } } });
    expect(mapFinishedScore(m, false)).toEqual({ resultStatus: "FT", baseHome: 3, baseAway: 1, penHome: null, penAway: null });
  });

  it("swaps the score into our orientation", () => {
    const m = base({ score: { winner: "HOME_TEAM", duration: "REGULAR", fullTime: { home: 3, away: 1 } } });
    expect(mapFinishedScore(m, true)).toEqual({ resultStatus: "FT", baseHome: 1, baseAway: 3, penHome: null, penAway: null });
  });

  it("maps extra time: fullTime already includes the 120-minute score", () => {
    const m = base({
      score: {
        winner: "HOME_TEAM",
        duration: "EXTRA_TIME",
        fullTime: { home: 2, away: 1 },
        regularTime: { home: 1, away: 1 },
        extraTime: { home: 1, away: 0 },
      },
    });
    expect(mapFinishedScore(m, false)).toEqual({ resultStatus: "AET", baseHome: 2, baseAway: 1, penHome: null, penAway: null });
  });

  it("maps a shootout: base = regular + extra, pens separate (fullTime includes the bump)", () => {
    const m = base({
      score: {
        winner: "AWAY_TEAM",
        duration: "PENALTY_SHOOTOUT",
        fullTime: { home: 1, away: 2 }, // 1:1 after 120 + shootout bump
        regularTime: { home: 1, away: 1 },
        extraTime: { home: 0, away: 0 },
        penalties: { home: 3, away: 5 },
      },
    });
    expect(mapFinishedScore(m, false)).toEqual({ resultStatus: "PEN", baseHome: 1, baseAway: 1, penHome: 3, penAway: 5 });
  });

  it("returns null while the match is not finished", () => {
    const m = base({
      status: "IN_PLAY",
      score: { winner: null, duration: "REGULAR", fullTime: { home: 1, away: 0 } },
    });
    expect(mapFinishedScore(m, false)).toBeNull();
  });
});
