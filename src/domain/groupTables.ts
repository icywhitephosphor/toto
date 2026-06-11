// Live group tables + knockout-slot projection. Pure functions: given the
// group-stage results entered so far, rank each group (points → goal diff →
// goals for; FIFA's deeper head-to-head/fair-play criteria are deliberately
// out of scope — this feeds a clearly-labelled *projection*, not scoring) and
// resolve bracket slots ('W-A', 'RU-B', 'W73', 'L101') to the team currently
// holding that spot. '3RD:...' slots are not projected: the Annex C allocation
// of best thirds across slots is combinatorial and would mislead more than help.

export interface GroupGame {
  groupCode: string;
  homeTeamId: string;
  awayTeamId: string;
  homeGoals: number;
  awayGoals: number;
}

export interface TableRow {
  teamId: string;
  played: number;
  points: number;
  gf: number;
  ga: number;
}

export function computeGroupTables(
  games: GroupGame[],
  teamsByGroup: Map<string, string[]>,
): Map<string, TableRow[]> {
  const rows = new Map<string, TableRow>(); // teamId -> row
  for (const [group, teamIds] of teamsByGroup) {
    void group;
    for (const id of teamIds) rows.set(id, { teamId: id, played: 0, points: 0, gf: 0, ga: 0 });
  }

  for (const g of games) {
    const home = rows.get(g.homeTeamId);
    const away = rows.get(g.awayTeamId);
    if (!home || !away) continue;
    home.played += 1;
    away.played += 1;
    home.gf += g.homeGoals;
    home.ga += g.awayGoals;
    away.gf += g.awayGoals;
    away.ga += g.homeGoals;
    if (g.homeGoals > g.awayGoals) home.points += 3;
    else if (g.homeGoals < g.awayGoals) away.points += 3;
    else {
      home.points += 1;
      away.points += 1;
    }
  }

  const tables = new Map<string, TableRow[]>();
  for (const [group, teamIds] of teamsByGroup) {
    const table = teamIds
      .map((id) => rows.get(id)!)
      .sort(
        (a, b) =>
          b.points - a.points ||
          (b.gf - b.ga) - (a.gf - a.ga) ||
          b.gf - a.gf ||
          a.teamId.localeCompare(b.teamId),
      );
    tables.set(group, table);
  }
  return tables;
}

export interface SlotContext {
  tables: Map<string, TableRow[]>;
  winnerByMatchNo: Map<number, string>; // fifa_match_no -> teamId
  loserByMatchNo: Map<number, string>;
}

/** The team currently projected into a bracket slot, or null if unknowable yet. */
export function projectSlot(slot: string | null, ctx: SlotContext): string | null {
  if (!slot) return null;
  const groupPlace = (group: string, place: number): string | null => {
    const table = ctx.tables.get(group);
    if (!table || table.every((r) => r.played === 0)) return null; // no signal yet
    return table[place]?.teamId ?? null;
  };
  if (slot.startsWith("W-")) return groupPlace(slot.slice(2), 0);
  if (slot.startsWith("RU-")) return groupPlace(slot.slice(3), 1);
  const m = /^([WL])(\d+)$/.exec(slot);
  if (m) {
    const no = Number(m[2]);
    return (m[1] === "W" ? ctx.winnerByMatchNo : ctx.loserByMatchNo).get(no) ?? null;
  }
  return null; // 3RD:* and anything unrecognized
}
