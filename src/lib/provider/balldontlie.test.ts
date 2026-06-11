import { describe, it, expect } from "vitest";
import { parseStandings } from "./balldontlie";

const row = (group: string, position: number, abbr: string, points = 0, played = 0) => ({
  position,
  played,
  points,
  goals_for: 0,
  goals_against: 0,
  team: { abbreviation: abbr },
  group: { name: `Group ${group}` },
});

describe("parseStandings", () => {
  it("groups by letter and orders by official position", () => {
    const tables = parseStandings([
      row("A", 2, "RSA"),
      row("A", 1, "MEX", 3, 1),
      row("B", 1, "SUI"),
    ]);
    expect([...tables.keys()].sort()).toEqual(["A", "B"]);
    expect(tables.get("A")!.map((r) => r.code)).toEqual(["MEX", "RSA"]);
    expect(tables.get("A")![0]).toMatchObject({ points: 3, played: 1 });
  });

  it("skips rows without a team code or group", () => {
    const tables = parseStandings([
      row("A", 1, "MEX"),
      { ...row("A", 2, "RSA"), team: { abbreviation: null } },
      { ...row("A", 3, "KOR"), group: { name: null } },
    ]);
    expect(tables.get("A")!.map((r) => r.code)).toEqual(["MEX"]);
  });
});
