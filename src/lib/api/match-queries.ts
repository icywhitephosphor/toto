// Match list/detail queries + serialization to the 06 §3.6 wire shape. Home and
// away teams are joined via aliases; the result object is attached when present.
import { and, eq, gte, lte, asc, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { matches, teams, matchResults } from "@/db/schema";
import { TOURNAMENT_ID } from "@/lib/env";
import { assignThirdSlots, computeGroupTables, projectSlot, type GroupGame, type SlotContext, type TableRow } from "@/domain/groupTables";
import { fetchOfficialTables } from "@/lib/provider/footballData";

const homeTeam = alias(teams, "home_team");
const awayTeam = alias(teams, "away_team");

function teamShape(t: {
  id: string | null;
  code: string | null;
  nameRu: string | null;
  nameEn: string | null;
  logoUrl: string | null;
}) {
  if (!t.id) return null;
  return { id: t.id, code: t.code, name_ru: t.nameRu, name_en: t.nameEn, logo_url: t.logoUrl };
}

type Row = Awaited<ReturnType<typeof runQuery>>[number];

function serialize(r: Row) {
  const result =
    r.resultStatus != null
      ? {
          result_status: r.resultStatus,
          base_home: r.baseHome,
          base_away: r.baseAway,
          pen_home: r.penHome,
          pen_away: r.penAway,
          toto_home: r.totoHome,
          toto_away: r.totoAway,
          winner_team_id: r.winnerTeamId,
          confirmed: r.confirmed,
          source: r.source,
        }
      : null;

  // Expose final results (FT/AET/PEN) and the LIVE in-play score (display only).
  // The real-world score is public the moment it lands — including an unconfirmed
  // play-off final (result_status=FT/AET/PEN, confirmed=false): the `confirmed`
  // flag gates only whether the result is *counted* for points (see recompute's
  // `usable` filter), never its visibility. We never surface a row with no score.
  const publicResult =
    result && ["FT", "AET", "PEN", "LIVE"].includes(result.result_status) ? result : null;

  return {
    id: r.id,
    fifa_match_no: r.fifaMatchNo,
    stage: r.stage,
    group_code: r.groupCode,
    home_team: teamShape({ id: r.homeId, code: r.homeCode, nameRu: r.homeNameRu, nameEn: r.homeNameEn, logoUrl: r.homeLogo }),
    away_team: teamShape({ id: r.awayId, code: r.awayCode, nameRu: r.awayNameRu, nameEn: r.awayNameEn, logoUrl: r.awayLogo }),
    home_slot: r.homeSlot,
    away_slot: r.awaySlot,
    kickoff_at: r.kickoffAt?.toISOString() ?? null,
    deadline_at: r.deadlineAt?.toISOString() ?? null,
    venue: r.venue,
    city: r.city,
    status: r.status,
    x2_allowed: r.x2Allowed,
    result: publicResult,
    // Filled by attachProjections() for knockout matches whose teams are not
    // resolved yet: who currently holds the slot per the live group tables.
    projected_home: null as TeamShapeOut,
    projected_away: null as TeamShapeOut,
  };
}

type TeamShapeOut = ReturnType<typeof teamShape>;

export type SerializedMatch = ReturnType<typeof serialize>;

/** Slot projections from public results only — same visibility as the UI. */
async function attachProjections(list: SerializedMatch[], all: SerializedMatch[]): Promise<SerializedMatch[]> {
  const teamsByGroup = new Map<string, string[]>();
  const teamById = new Map<string, NonNullable<TeamShapeOut>>();
  const games: GroupGame[] = [];
  const winnerByMatchNo = new Map<number, string>();
  const loserByMatchNo = new Map<number, string>();

  for (const m of all) {
    for (const t of [m.home_team, m.away_team]) if (t) teamById.set(t.id, t);
    if (m.stage === "GROUP" && m.group_code) {
      for (const t of [m.home_team, m.away_team]) {
        if (!t) continue;
        if (!teamsByGroup.has(m.group_code)) teamsByGroup.set(m.group_code, []);
        const arr = teamsByGroup.get(m.group_code)!;
        if (!arr.includes(t.id)) arr.push(t.id);
      }
      if (m.result?.toto_home != null && m.result.toto_away != null && m.home_team && m.away_team) {
        games.push({
          groupCode: m.group_code,
          homeTeamId: m.home_team.id,
          awayTeamId: m.away_team.id,
          homeGoals: m.result.toto_home,
          awayGoals: m.result.toto_away,
        });
      }
    } else if (m.result?.winner_team_id && m.home_team && m.away_team) {
      winnerByMatchNo.set(m.fifa_match_no, m.result.winner_team_id);
      loserByMatchNo.set(
        m.fifa_match_no,
        m.result.winner_team_id === m.home_team.id ? m.away_team.id : m.home_team.id,
      );
    }
  }

  const teamName = (id: string) => teamById.get(id)?.name_ru ?? id;
  // Prefer the OFFICIAL group tables (football-data standings, full FIFA
  // tie-breaks); fall back to our simplified local ranking when the feed is
  // absent or down.
  const teamIdByCode = new Map<string, string>();
  for (const t of teamById.values()) if (t.code) teamIdByCode.set(t.code, t.id);
  let tables = computeGroupTables(games, teamsByGroup, teamName);
  const official = await fetchOfficialTables();
  if (official) {
    const mapped = new Map<string, TableRow[]>();
    let complete = true;
    for (const [group, rows] of official) {
      const table: TableRow[] = [];
      for (const r of rows) {
        const teamId = teamIdByCode.get(r.code);
        if (!teamId) { complete = false; continue; }
        table.push({ teamId, played: r.played, points: r.points, gf: r.gf, ga: r.ga });
      }
      mapped.set(group, table);
    }
    if (complete && mapped.size === teamsByGroup.size) tables = mapped;
  }
  // 3RD slots are assigned in bracket order so each group's third is used once.
  const thirdSlots = all
    .filter((m) => m.stage === "R32")
    .sort((a, b) => a.fifa_match_no - b.fifa_match_no)
    .flatMap((m) => [m.home_slot, m.away_slot])
    .filter((s): s is string => !!s && s.startsWith("3RD:"));
  const ctx: SlotContext = {
    tables,
    winnerByMatchNo,
    loserByMatchNo,
    thirdAssignments: assignThirdSlots(thirdSlots, tables, teamName),
  };

  return list.map((m) => {
    if (m.stage === "GROUP" || (m.home_team && m.away_team)) return m;
    const homeId = m.home_team ? null : projectSlot(m.home_slot, ctx);
    const awayId = m.away_team ? null : projectSlot(m.away_slot, ctx);
    return {
      ...m,
      projected_home: homeId ? (teamById.get(homeId) ?? null) : null,
      projected_away: awayId ? (teamById.get(awayId) ?? null) : null,
    };
  });
}

async function runQuery(where: SQL | undefined) {
  return db
    .select({
      id: matches.id,
      fifaMatchNo: matches.fifaMatchNo,
      stage: matches.stage,
      groupCode: matches.groupCode,
      homeSlot: matches.homeSlot,
      awaySlot: matches.awaySlot,
      kickoffAt: matches.kickoffAt,
      deadlineAt: matches.deadlineAt,
      venue: matches.venue,
      city: matches.city,
      status: matches.status,
      x2Allowed: matches.x2Allowed,
      homeId: homeTeam.id,
      homeCode: homeTeam.code,
      homeNameRu: homeTeam.nameRu,
      homeNameEn: homeTeam.nameEn,
      homeLogo: homeTeam.logoUrl,
      awayId: awayTeam.id,
      awayCode: awayTeam.code,
      awayNameRu: awayTeam.nameRu,
      awayNameEn: awayTeam.nameEn,
      awayLogo: awayTeam.logoUrl,
      resultStatus: matchResults.resultStatus,
      baseHome: matchResults.baseHome,
      baseAway: matchResults.baseAway,
      penHome: matchResults.penHome,
      penAway: matchResults.penAway,
      totoHome: matchResults.totoHome,
      totoAway: matchResults.totoAway,
      winnerTeamId: matchResults.winnerTeamId,
      confirmed: matchResults.confirmed,
      source: matchResults.source,
    })
    .from(matches)
    .leftJoin(homeTeam, eq(homeTeam.id, matches.homeTeamId))
    .leftJoin(awayTeam, eq(awayTeam.id, matches.awayTeamId))
    .leftJoin(matchResults, eq(matchResults.matchId, matches.id))
    .where(where)
    .orderBy(asc(matches.fifaMatchNo));
}

export interface MatchFilters {
  stage?: string;
  from?: Date;
  to?: Date;
  status?: string;
}

export async function listMatches(filters: MatchFilters = {}): Promise<SerializedMatch[]> {
  const conds: SQL[] = [eq(matches.tournamentId, TOURNAMENT_ID)];
  if (filters.stage) conds.push(eq(matches.stage, filters.stage));
  if (filters.status) conds.push(eq(matches.status, filters.status));
  if (filters.from) conds.push(gte(matches.kickoffAt, filters.from));
  if (filters.to) conds.push(lte(matches.kickoffAt, filters.to));
  const filtered = conds.length > 1;
  const rows = await runQuery(and(...conds));
  const serialized = rows.map(serialize);
  // Projections need the full tournament picture (group tables + finished
  // knockout matches); the common unfiltered call already has it.
  const all = filtered ? (await runQuery(eq(matches.tournamentId, TOURNAMENT_ID))).map(serialize) : serialized;
  return attachProjections(serialized, all);
}

export async function getMatchById(id: string): Promise<SerializedMatch | null> {
  const all = (await runQuery(eq(matches.tournamentId, TOURNAMENT_ID))).map(serialize);
  const one = all.find((m) => m.id === id);
  return one ? (await attachProjections([one], all))[0] : null;
}
