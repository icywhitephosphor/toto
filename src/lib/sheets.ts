// Google Sheets export (architecture/09). Phase 1 = ONE private spreadsheet with
// full data (the public/redacted split is Phase 2, 13 §3). DB → Sheets only;
// nothing is read back. Config-gated: throws SHEETS_NOT_CONFIGURED when the
// service account / SHEET_ID are absent, so local dev/CI never needs Google creds.
import { google } from "googleapis";
import { and, asc, eq, desc } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  matches,
  matchResults,
  matchBets,
  bonusBets,
  bonusBetItems,
  bonusCategories,
  participants,
  teams,
  scoreEvents,
  leaderboardSnapshots,
  sheetExportLog,
} from "@/db/schema";
import { env, TOURNAMENT_ID } from "@/lib/env";
import { AppError } from "@/lib/http";

const MSK = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const fmtMsk = (d: Date | null) => (d ? MSK.format(d) : "");
const fmtIso = (d: Date | null) => (d ? d.toISOString() : "");

function sheetsClient() {
  if (!env.googleSaJson || !env.sheetId) {
    throw new AppError(422, "SHEETS_NOT_CONFIGURED", "GOOGLE_SA_JSON and SHEET_ID are required");
  }
  const credentials = JSON.parse(env.googleSaJson);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

const TAB_NAMES = ["Leaderboard", "Results", "All Match Bets", "All Bonus Bets", "Participants"];

type Sheets = ReturnType<typeof sheetsClient>;

async function ensureTabs(sheets: Sheets, spreadsheetId: string): Promise<void> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = new Set((meta.data.sheets ?? []).map((s) => s.properties?.title));
  const missing = TAB_NAMES.filter((t) => !existing.has(t));
  if (missing.length === 0) return;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: missing.map((title) => ({ addSheet: { properties: { title } } })) },
  });
}

async function fullRefresh(sheets: Sheets, spreadsheetId: string, ranges: { sheetName: string; values: string[][] }[]) {
  await sheets.spreadsheets.values.batchClear({
    spreadsheetId,
    requestBody: { ranges: ranges.map((r) => `${r.sheetName}!A:ZZ`) },
  });
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "RAW",
      data: ranges.map((r) => ({ range: `${r.sheetName}!A1`, values: r.values })),
    },
  });
}

const homeTeam = alias(teams, "h");
const awayTeam = alias(teams, "a");

async function buildLeaderboard(): Promise<string[][]> {
  const [snap] = await db
    .select()
    .from(leaderboardSnapshots)
    .where(eq(leaderboardSnapshots.tournamentId, TOURNAMENT_ID))
    .orderBy(desc(leaderboardSnapshots.generatedAt))
    .limit(1);
  const header = ["place", "display_name", "total_points", "match_points", "bonus_points", "playoff_match_points", "key_bonus_points", "prize"];
  if (!snap) return [header];
  const rows = (snap.rows as Array<Record<string, unknown>>) ?? [];
  return [
    header,
    ...rows.map((r) => [
      String(r.place ?? ""),
      String(r.display_name ?? ""),
      String(r.total_points ?? 0),
      String(r.match_points ?? 0),
      String(r.bonus_points ?? 0),
      String(r.playoff_match_points ?? 0),
      String(r.key_bonus_points ?? 0),
      r.prize && typeof r.prize === "object" ? String((r.prize as { amount?: number }).amount ?? "") : "",
    ]),
  ];
}

async function buildResults(): Promise<string[][]> {
  const rows = await db
    .select({
      no: matches.fifaMatchNo,
      stage: matches.stage,
      home: homeTeam.nameRu,
      away: awayTeam.nameRu,
      totoHome: matchResults.totoHome,
      totoAway: matchResults.totoAway,
      resultStatus: matchResults.resultStatus,
      status: matches.status,
      kickoff: matches.kickoffAt,
    })
    .from(matches)
    .leftJoin(homeTeam, eq(homeTeam.id, matches.homeTeamId))
    .leftJoin(awayTeam, eq(awayTeam.id, matches.awayTeamId))
    .leftJoin(matchResults, eq(matchResults.matchId, matches.id))
    .where(eq(matches.tournamentId, TOURNAMENT_ID))
    .orderBy(asc(matches.fifaMatchNo));
  return [
    ["fifa_match_no", "stage", "home_name_ru", "away_name_ru", "toto_home", "toto_away", "result_status", "match_status", "kickoff_at_msk"],
    ...rows.map((r) => [
      String(r.no),
      r.stage,
      r.home ?? "",
      r.away ?? "",
      r.totoHome != null ? String(r.totoHome) : "",
      r.totoAway != null ? String(r.totoAway) : "",
      r.resultStatus ?? "",
      r.status,
      fmtMsk(r.kickoff),
    ]),
  ];
}

async function buildAllMatchBets(): Promise<string[][]> {
  const rows = await db
    .select({
      name: participants.displayName,
      rosterNo: participants.rosterNo,
      no: matches.fifaMatchNo,
      stage: matches.stage,
      home: homeTeam.nameRu,
      away: awayTeam.nameRu,
      predHome: matchBets.predHome,
      predAway: matchBets.predAway,
      x2: matchBets.x2,
      submitted: matchBets.submittedAt,
      updated: matchBets.updatedAt,
      version: matchBets.version,
      points: scoreEvents.points,
    })
    .from(matchBets)
    .innerJoin(participants, eq(participants.id, matchBets.participantId))
    .innerJoin(matches, eq(matches.id, matchBets.matchId))
    .leftJoin(homeTeam, eq(homeTeam.id, matches.homeTeamId))
    .leftJoin(awayTeam, eq(awayTeam.id, matches.awayTeamId))
    .leftJoin(
      scoreEvents,
      and(eq(scoreEvents.participantId, matchBets.participantId), eq(scoreEvents.matchId, matchBets.matchId)),
    )
    .orderBy(asc(matches.fifaMatchNo), asc(participants.rosterNo));
  return [
    ["display_name", "fifa_match_no", "stage", "home_name_ru", "away_name_ru", "pred_home", "pred_away", "x2", "submitted_at", "updated_at", "version", "points"],
    ...rows.map((r) => [
      r.name,
      String(r.no),
      r.stage,
      r.home ?? "",
      r.away ?? "",
      String(r.predHome),
      String(r.predAway),
      r.x2 ? "TRUE" : "FALSE",
      fmtIso(r.submitted),
      fmtIso(r.updated),
      String(r.version),
      r.points != null ? String(r.points) : "",
    ]),
  ];
}

async function buildAllBonusBets(): Promise<string[][]> {
  const bets = await db
    .select({
      betId: bonusBets.id,
      name: participants.displayName,
      rosterNo: participants.rosterNo,
      categoryId: bonusBets.categoryId,
      categoryName: bonusCategories.nameRu,
      submitted: bonusBets.submittedAt,
      locked: bonusBets.lockedAt,
    })
    .from(bonusBets)
    .innerJoin(participants, eq(participants.id, bonusBets.participantId))
    .innerJoin(bonusCategories, eq(bonusCategories.id, bonusBets.categoryId))
    .orderBy(asc(participants.rosterNo), asc(bonusCategories.sortOrder));

  const itemRows = await db
    .select({ betId: bonusBetItems.bonusBetId, code: teams.code, player: bonusBetItems.playerName, pos: bonusBetItems.position })
    .from(bonusBetItems)
    .leftJoin(teams, eq(teams.id, bonusBetItems.teamId));
  const picksByBet = new Map<string, string[]>();
  for (const it of itemRows.sort((a, b) => a.pos - b.pos)) {
    if (!picksByBet.has(it.betId)) picksByBet.set(it.betId, []);
    picksByBet.get(it.betId)!.push(it.code ?? it.player ?? "");
  }

  const pointRows = await db
    .select({ participantId: scoreEvents.participantId, categoryId: scoreEvents.categoryId, points: scoreEvents.points })
    .from(scoreEvents)
    .where(eq(scoreEvents.source, "BONUS"));
  const pointKey = (pid: string, cid: string) => `${pid}:${cid}`;
  const pointsMap = new Map<string, number>();
  for (const p of pointRows) if (p.categoryId) pointsMap.set(pointKey(p.participantId, p.categoryId), p.points);

  // We need participant id per bet to look up points — re-query betId→participant.
  const betPart = await db
    .select({ betId: bonusBets.id, participantId: bonusBets.participantId, categoryId: bonusBets.categoryId })
    .from(bonusBets);
  const partByBet = new Map(betPart.map((b) => [b.betId, b]));

  return [
    ["display_name", "category_id", "category_name_ru", "picks", "submitted_at", "locked_at", "points"],
    ...bets.map((b) => {
      const meta = partByBet.get(b.betId);
      const pts = meta ? pointsMap.get(pointKey(meta.participantId, meta.categoryId)) : undefined;
      return [
        b.name,
        b.categoryId,
        b.categoryName,
        (picksByBet.get(b.betId) ?? []).join(", "),
        fmtIso(b.submitted),
        fmtIso(b.locked),
        pts != null ? String(pts) : "",
      ];
    }),
  ];
}

async function buildParticipants(): Promise<string[][]> {
  const rows = await db
    .select({ rosterNo: participants.rosterNo, name: participants.displayName, status: participants.status, userId: participants.userId })
    .from(participants)
    .orderBy(asc(participants.rosterNo));
  return [
    ["roster_no", "display_name", "status", "user_id", "claimed"],
    ...rows.map((r) => [String(r.rosterNo), r.name, r.status, r.userId ?? "", r.userId ? "TRUE" : "FALSE"]),
  ];
}

export interface ExportResult {
  rowsWritten: number;
  exportLogId: string;
}

export async function runSheetsExport(mode: "FULL" | "AUDIT_APPEND" = "FULL"): Promise<ExportResult> {
  const startedAt = new Date();
  let ok = false;
  let error: string | undefined;
  let totalRows = 0;

  try {
    const sheets = sheetsClient();
    const spreadsheetId = env.sheetId!;
    await ensureTabs(sheets, spreadsheetId);

    const [leaderboard, results, allMatchBets, allBonusBets, parts] = await Promise.all([
      buildLeaderboard(),
      buildResults(),
      buildAllMatchBets(),
      buildAllBonusBets(),
      buildParticipants(),
    ]);

    await fullRefresh(sheets, spreadsheetId, [
      { sheetName: "Leaderboard", values: leaderboard },
      { sheetName: "Results", values: results },
      { sheetName: "All Match Bets", values: allMatchBets },
      { sheetName: "All Bonus Bets", values: allBonusBets },
      { sheetName: "Participants", values: parts },
    ]);

    totalRows = leaderboard.length + results.length + allMatchBets.length + allBonusBets.length + parts.length;
    ok = true;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    const [log] = await db
      .insert(sheetExportLog)
      .values({ mode, target: "private", rows: totalRows, ok, error: error ?? null, finishedAt: new Date(), startedAt })
      .returning({ id: sheetExportLog.id });
    lastExportLogId = log.id;
  }

  return { rowsWritten: totalRows, exportLogId: lastExportLogId };
}

// Captures the most recent export log id written in the finally block above.
let lastExportLogId = "";
