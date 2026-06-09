// Match list/detail queries + serialization to the 06 §3.6 wire shape. Home and
// away teams are joined via aliases; the result object is attached when present.
import { and, eq, gte, lte, asc, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { matches, teams, matchResults } from "@/db/schema";
import { TOURNAMENT_ID } from "@/lib/env";

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

  // Hide unconfirmed/non-final result detail from the public match shape: only
  // expose the result once it is FT/AET/PEN (08). LIVE/AWAITING stays null here.
  const publicResult =
    result && ["FT", "AET", "PEN"].includes(result.result_status) ? result : null;

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
  };
}

export type SerializedMatch = ReturnType<typeof serialize>;

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
  const rows = await runQuery(and(...conds));
  return rows.map(serialize);
}

export async function getMatchById(id: string): Promise<SerializedMatch | null> {
  const rows = await runQuery(and(eq(matches.tournamentId, TOURNAMENT_ID), eq(matches.id, id)));
  return rows[0] ? serialize(rows[0]) : null;
}
