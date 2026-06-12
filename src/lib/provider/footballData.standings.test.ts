import { describe, it, expect } from "vitest";
import { parseFdStandings } from "./footballData";

const entry = (group: string, table: Array<[number, string, number, number]>) => ({
  group,
  type: "TOTAL",
  table: table.map(([position, tla, points, playedGames]) => ({
    position,
    playedGames,
    points,
    goalsFor: 0,
    goalsAgainst: 0,
    team: { tla },
  })),
});

describe("parseFdStandings", () => {
  it("strips the group prefix and orders by official position", () => {
    const tables = parseFdStandings([
      entry("GROUP_A", [[2, "KOR", 3, 1], [1, "MEX", 3, 1]]),
      entry("Group B", [[1, "SUI", 0, 0]]),
    ]);
    expect([...tables.keys()].sort()).toEqual(["A", "B"]);
    expect(tables.get("A")!.map((r) => r.code)).toEqual(["MEX", "KOR"]);
  });

  it("maps URY to our URU and skips non-TOTAL tables", () => {
    const tables = parseFdStandings([
      entry("GROUP_H", [[1, "URY", 3, 1]]),
      { ...entry("GROUP_H", [[1, "ESP", 99, 9]]), type: "HOME" },
    ]);
    expect(tables.get("H")!.map((r) => r.code)).toEqual(["URU"]);
  });
});
