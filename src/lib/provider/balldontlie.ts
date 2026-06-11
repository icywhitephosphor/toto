// balldontlie FIFA World Cup API — official group standings (the user's
// ALL-STAR tier covers /group_standings; /matches needs the GOAT tier, so live
// scores still come from football-data). Standings reflect FIFA's full
// tie-break rules, so bracket projections prefer them over our simplified
// local ranking. Config-gated on BDL_KEY; everything degrades gracefully.
import { env } from "@/lib/env";

interface BdlStandingRow {
  position: number;
  played: number;
  points: number;
  goals_for: number;
  goals_against: number;
  team: { abbreviation: string | null } | null;
  group: { name: string | null } | null; // "Group A"
}

export interface OfficialTableRow {
  code: string; // FIFA code, identical to teams.code in our DB
  position: number;
  played: number;
  points: number;
  gf: number;
  ga: number;
}

/** Pure: API rows → per-group tables ordered by official position. */
export function parseStandings(rows: BdlStandingRow[]): Map<string, OfficialTableRow[]> {
  const byGroup = new Map<string, OfficialTableRow[]>();
  for (const r of rows) {
    const code = r.team?.abbreviation;
    const group = r.group?.name?.replace(/^Group\s+/i, "");
    if (!code || !group) continue;
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group)!.push({
      code,
      position: r.position,
      played: r.played,
      points: r.points,
      gf: r.goals_for,
      ga: r.goals_against,
    });
  }
  for (const table of byGroup.values()) table.sort((a, b) => a.position - b.position);
  return byGroup;
}

// Request-path cache: success 60s, failure 30s — /api/matches must stay fast
// and must never hammer the API (ALL-STAR = 60 req/min, we use ~1).
let cache: { at: number; ttlMs: number; tables: Map<string, OfficialTableRow[]> | null } | null = null;

export async function fetchOfficialTables(): Promise<Map<string, OfficialTableRow[]> | null> {
  if (!env.bdlKey) return null;
  const now = Date.now();
  if (cache && now - cache.at < cache.ttlMs) return cache.tables;
  try {
    const res = await fetch(
      "https://api.balldontlie.io/fifa/worldcup/v1/group_standings?per_page=100",
      { headers: { Authorization: env.bdlKey }, signal: AbortSignal.timeout(1500) },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { data?: BdlStandingRow[] };
    const tables = parseStandings(body.data ?? []);
    // A 48-team tournament must yield 12 groups; anything less is a bad payload.
    if (tables.size < 12) throw new Error(`unexpected groups: ${tables.size}`);
    cache = { at: now, ttlMs: 60_000, tables };
    return tables;
  } catch {
    cache = { at: now, ttlMs: 30_000, tables: null };
    return null;
  }
}
