import { describe, it, expect } from "vitest";
import { computeGroupTables, projectSlot, type SlotContext } from "./groupTables";

const teamsByGroup = new Map([["A", ["mex", "rsa", "kor", "cze"]]]);

describe("computeGroupTables", () => {
  it("ranks by points, then goal difference, then goals for", () => {
    const tables = computeGroupTables(
      [
        { groupCode: "A", homeTeamId: "mex", awayTeamId: "rsa", homeGoals: 3, awayGoals: 1 },
        { groupCode: "A", homeTeamId: "kor", awayTeamId: "cze", homeGoals: 2, awayGoals: 0 },
        { groupCode: "A", homeTeamId: "mex", awayTeamId: "cze", homeGoals: 0, awayGoals: 0 },
        { groupCode: "A", homeTeamId: "kor", awayTeamId: "rsa", homeGoals: 0, awayGoals: 1 },
      ],
      teamsByGroup,
    );
    const a = tables.get("A")!;
    // mex 4pts (+2), kor 3pts (+1), rsa 3pts (-1), cze 1pt (-2)
    expect(a.map((r) => r.teamId)).toEqual(["mex", "kor", "rsa", "cze"]);
  });

  it("keeps zero-played teams in the table", () => {
    const tables = computeGroupTables([], teamsByGroup);
    expect(tables.get("A")).toHaveLength(4);
  });
});

describe("projectSlot", () => {
  const ctx: SlotContext = {
    tables: computeGroupTables(
      [{ groupCode: "A", homeTeamId: "mex", awayTeamId: "rsa", homeGoals: 3, awayGoals: 1 }],
      teamsByGroup,
    ),
    winnerByMatchNo: new Map([[73, "mex"]]),
    loserByMatchNo: new Map([[73, "rsa"]]),
  };

  it("projects group winner and runner-up from the live table", () => {
    expect(projectSlot("W-A", ctx)).toBe("mex");
    // After one game the loser (GD −2) sits below the two unplayed teams (GD 0):
    // the current runner-up is the alphabetically-first unplayed team.
    expect(projectSlot("RU-A", ctx)).toBe("cze");
  });

  it("returns null for a group with no results yet", () => {
    const empty: SlotContext = { ...ctx, tables: computeGroupTables([], teamsByGroup) };
    expect(projectSlot("W-A", empty)).toBeNull();
  });

  it("resolves W##/L## from finished matches and skips 3RD slots", () => {
    expect(projectSlot("W73", ctx)).toBe("mex");
    expect(projectSlot("L73", ctx)).toBe("rsa");
    expect(projectSlot("3RD:A/B/C/D/F", ctx)).toBeNull();
  });
});
