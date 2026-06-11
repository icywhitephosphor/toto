// Live group tables + knockout-slot projection. Pure functions: given the
// group-stage results entered so far, rank each group (points → goal diff →
// goals for → name; FIFA's deeper head-to-head/fair-play criteria are
// deliberately out of scope — this feeds a clearly-labelled *projection*, not
// scoring). Before any results land the order is alphabetical, exactly like
// Flashscore's pre-tournament tables, and it reshuffles as results arrive.

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

export type TeamName = (teamId: string) => string;

function rowCompare(a: TableRow, b: TableRow, name: TeamName): number {
  return (
    b.points - a.points ||
    (b.gf - b.ga) - (a.gf - a.ga) ||
    b.gf - a.gf ||
    name(a.teamId).localeCompare(name(b.teamId), "ru")
  );
}

export function computeGroupTables(
  games: GroupGame[],
  teamsByGroup: Map<string, string[]>,
  teamName: TeamName = (id) => id,
): Map<string, TableRow[]> {
  const rows = new Map<string, TableRow>(); // teamId -> row
  for (const teamIds of teamsByGroup.values()) {
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
    tables.set(group, teamIds.map((id) => rows.get(id)!).sort((a, b) => rowCompare(a, b, teamName)));
  }
  return tables;
}

/**
 * Project the '3RD:A/B/C/…' slots: rank all third-placed teams (same criteria
 * as the group tables), then walk the slots in bracket order giving each the
 * best-ranked still-unassigned third from its allowed groups. Greedy — FIFA's
 * Annex C combination table is more subtle, but this is a labelled projection.
 */
export function assignThirdSlots(
  slots: string[],
  tables: Map<string, TableRow[]>,
  teamName: TeamName = (id) => id,
): Map<string, string> {
  const thirds = [...tables.entries()]
    .map(([group, table]) => ({ group, row: table[2] }))
    .filter((x): x is { group: string; row: TableRow } => x.row != null)
    .sort((a, b) => rowCompare(a.row, b.row, teamName));

  const taken = new Set<string>();
  const out = new Map<string, string>();
  for (const slot of slots) {
    if (!slot.startsWith("3RD:")) continue;
    const allowed = new Set(slot.slice(4).split("/"));
    const pick = thirds.find((t) => allowed.has(t.group) && !taken.has(t.group));
    if (pick) {
      taken.add(pick.group);
      out.set(slot, pick.row.teamId);
    }
  }
  return out;
}

export interface SlotContext {
  tables: Map<string, TableRow[]>;
  winnerByMatchNo: Map<number, string>; // fifa_match_no -> teamId
  loserByMatchNo: Map<number, string>;
  thirdAssignments?: Map<string, string>; // '3RD:…' slot string -> teamId
}

/** The team currently projected into a bracket slot, or null if unknowable. */
export function projectSlot(slot: string | null, ctx: SlotContext): string | null {
  if (!slot) return null;
  const groupPlace = (group: string, place: number): string | null =>
    ctx.tables.get(group)?.[place]?.teamId ?? null;
  if (slot.startsWith("W-")) return groupPlace(slot.slice(2), 0);
  if (slot.startsWith("RU-")) return groupPlace(slot.slice(3), 1);
  if (slot.startsWith("3RD:")) return ctx.thirdAssignments?.get(slot) ?? null;
  const m = /^([WL])(\d+)$/.exec(slot);
  if (m) {
    const no = Number(m[2]);
    return (m[1] === "W" ? ctx.winnerByMatchNo : ctx.loserByMatchNo).get(no) ?? null;
  }
  return null;
}
