import { describe, it, expect } from "vitest";
import { mapGame, type Wc26Game } from "./worldcup26";

const TEAMS = new Map([
  ["1", "MEX"],
  ["2", "RSA"],
]);

const base: Wc26Game = {
  id: "1",
  type: "group",
  home_team_id: "1",
  away_team_id: "2",
  home_score: "2",
  away_score: "0",
  finished: "TRUE",
  time_elapsed: "90",
};

describe("wc26 mapGame", () => {
  it("coerces string scores/flags and maps stage", () => {
    expect(mapGame(base, TEAMS)).toEqual({
      homeCode: "MEX",
      awayCode: "RSA",
      stage: "GROUP",
      home: 2,
      away: 0,
      finished: true,
      minute: 90,
    });
  });

  it("treats finished='FALSE' as live and r32 as R32", () => {
    const g = mapGame({ ...base, type: "r32", finished: "FALSE", time_elapsed: "57" }, TEAMS);
    expect(g).toMatchObject({ stage: "R32", finished: false, minute: 57 });
  });

  it("returns null for unresolved knockout slots (team id '0') and unknown types", () => {
    expect(mapGame({ ...base, home_team_id: "0" }, TEAMS)).toBeNull();
    expect(mapGame({ ...base, type: "mystery" }, TEAMS)).toBeNull();
  });

  it("returns null when scores are absent", () => {
    expect(mapGame({ ...base, home_score: null }, TEAMS)).toBeNull();
    expect(mapGame({ ...base, away_score: "" }, TEAMS)).toBeNull();
  });
});
