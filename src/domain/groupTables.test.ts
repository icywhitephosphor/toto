import { describe, it, expect } from "vitest";
import { assignThirdSlots, computeGroupTables, projectSlot, type SlotContext } from "./groupTables";

const teamsByGroup = new Map([["A", ["mex", "rsa", "kor", "cze"]]]);
const NAMES: Record<string, string> = {
  mex: "Мексика", rsa: "ЮАР", kor: "Южная Корея", cze: "Чехия",
  bra: "Бразилия", mar: "Марокко", hai: "Гаити", sco: "Шотландия",
};
const name = (id: string) => NAMES[id] ?? id;

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
      name,
    );
    // mex 4pts (+2), kor 3pts (+1), rsa 3pts (-1), cze 1pt (-2)
    expect(tables.get("A")!.map((r) => r.teamId)).toEqual(["mex", "kor", "rsa", "cze"]);
  });

  it("orders alphabetically (ru) before any results — Flashscore-style", () => {
    const tables = computeGroupTables([], teamsByGroup, name);
    // Мексика < Чехия < ЮАР < Южная Корея
    expect(tables.get("A")!.map((r) => r.teamId)).toEqual(["mex", "cze", "rsa", "kor"]);
  });
});

describe("projectSlot", () => {
  const ctx: SlotContext = {
    tables: computeGroupTables(
      [{ groupCode: "A", homeTeamId: "mex", awayTeamId: "rsa", homeGoals: 3, awayGoals: 1 }],
      teamsByGroup,
      name,
    ),
    winnerByMatchNo: new Map([[73, "mex"]]),
    loserByMatchNo: new Map([[73, "rsa"]]),
  };

  it("projects group winner and runner-up from the live table", () => {
    expect(projectSlot("W-A", ctx)).toBe("mex");
    // The loser (GD −2) sits below the two unplayed teams; the current
    // runner-up is the alphabetically-first unplayed team (Чехия).
    expect(projectSlot("RU-A", ctx)).toBe("cze");
  });

  it("projects even with zero results (alphabetical table)", () => {
    const empty: SlotContext = { ...ctx, tables: computeGroupTables([], teamsByGroup, name) };
    expect(projectSlot("W-A", empty)).toBe("mex");
  });

  it("resolves W##/L## from finished matches", () => {
    expect(projectSlot("W73", ctx)).toBe("mex");
    expect(projectSlot("L73", ctx)).toBe("rsa");
  });
});

describe("assignThirdSlots", () => {
  it("gives each slot the best available third, one per group", () => {
    const two = new Map([
      ["A", ["mex", "rsa", "kor", "cze"]],
      ["C", ["bra", "mar", "hai", "sco"]],
    ]);
    const tables = computeGroupTables(
      [
        // A: kor third with 3 pts (+1)
        { groupCode: "A", homeTeamId: "mex", awayTeamId: "kor", homeGoals: 2, awayGoals: 0 },
        { groupCode: "A", homeTeamId: "rsa", awayTeamId: "cze", homeGoals: 1, awayGoals: 0 },
        { groupCode: "A", homeTeamId: "kor", awayTeamId: "cze", homeGoals: 2, awayGoals: 1 },
        // C: bra/mar on 3 pts, sco bottom with two losses → hai is third
        { groupCode: "C", homeTeamId: "bra", awayTeamId: "sco", homeGoals: 2, awayGoals: 0 },
        { groupCode: "C", homeTeamId: "mar", awayTeamId: "sco", homeGoals: 1, awayGoals: 0 },
      ],
      two,
      name,
    );
    // Thirds ranking: kor (3 pts) above hai (0 pts). Both slots allow A and C:
    // the first takes kor, the second falls back to hai (group A already used).
    const assigned = assignThirdSlots(["3RD:A/C", "3RD:C/A"], tables, name);
    expect(assigned.get("3RD:A/C")).toBe("kor");
    expect(assigned.get("3RD:C/A")).toBe("hai");
  });
});
