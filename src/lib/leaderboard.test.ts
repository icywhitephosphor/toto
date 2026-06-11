import { describe, it, expect } from "vitest";
import { buildLeaderboardRows, type StandingRow } from "./leaderboard";

const row = (overrides: Partial<StandingRow> & Pick<StandingRow, "participantId" | "displayName">): StandingRow => ({
  totalPoints: 0,
  matchPoints: 0,
  bonusPoints: 0,
  playoffMatchPoints: 0,
  keyBonusPoints: 0,
  tiebreakRank: null,
  ...overrides,
});

describe("buildLeaderboardRows — tie ordering", () => {
  it("orders a full tie group alphabetically (ru), all sharing one place", () => {
    const standings = [
      row({ participantId: "c", displayName: "Яшин Лев" }),
      row({ participantId: "a", displayName: "Бобров Всеволод" }),
      row({ participantId: "b", displayName: "Аршавин Андрей" }),
    ];
    const rows = buildLeaderboardRows(standings, new Map(), new Set());
    expect(rows.map((r) => r.display_name)).toEqual(["Аршавин Андрей", "Бобров Всеволод", "Яшин Лев"]);
    expect(rows.map((r) => r.place)).toEqual([1, 1, 1]);
  });

  it("keeps points ordering above the alphabetical fallback", () => {
    const standings = [
      row({ participantId: "a", displayName: "Аршавин Андрей" }),
      row({ participantId: "b", displayName: "Яшин Лев", totalPoints: 5, matchPoints: 5 }),
    ];
    const rows = buildLeaderboardRows(standings, new Map(), new Set());
    expect(rows.map((r) => r.display_name)).toEqual(["Яшин Лев", "Аршавин Андрей"]);
    expect(rows.map((r) => r.place)).toEqual([1, 2]);
  });
});
