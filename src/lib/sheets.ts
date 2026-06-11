// Google Sheets export (architecture/09). Phase 1 = ONE private spreadsheet with
// full data, formatted for humans: Russian headers, country flags, centred
// cells, a group-winners grid and a per-category bonus list with ✓/✗ once a
// category is settled. DB → Sheets only; nothing is read back. Config-gated:
// throws SHEETS_NOT_CONFIGURED when creds/SHEET_ID are absent.
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
  bonusOutcomes,
  participants,
  teams,
  scoreEvents,
  leaderboardSnapshots,
  sheetExportLog,
} from "@/db/schema";
import { env, TOURNAMENT_ID } from "@/lib/env";
import { AppError } from "@/lib/http";
import { flag } from "@/lib/client/flags";
import { GROUP_CODES } from "@/domain/teams";
import { prizeForPlace } from "@/domain/prizes";
import { normalizePlayerName } from "@/scoring/bonusScoring";

const MSK = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const fmtMsk = (d: Date | null) => (d ? MSK.format(d).replace(",", "") : "");

const STAGE_RU: Record<string, string> = {
  GROUP: "Группа",
  R32: "1/16",
  R16: "1/8",
  QF: "1/4",
  SF: "1/2",
  THIRD: "За 3-е",
  FINAL: "Финал",
};

const MEDAL = ["🥇", "🥈", "🥉"];
const RUB = (n: number) => `${n.toLocaleString("ru-RU")} ₽`;

/** "🇲🇽 Мексика" (or just the name if the code is unknown / empty). */
const withFlag = (code: string | null | undefined, name: string | null | undefined) =>
  name ? (code ? `${flag(code)} ${name}` : name) : "";

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

type Sheets = ReturnType<typeof sheetsClient>;

// A formatted tab: its values (incl. header row) plus which columns stay
// left-aligned (everything else is centred) and which wrap as wide text.
interface SheetSpec {
  title: string;
  values: string[][];
  leftCols: number[];
  wrapCols?: number[];
}

const TAB_NAMES = ["Таблица", "Результаты", "Ставки на матчи", "Победители групп", "Бонусы", "Участники"];
// Tabs an earlier version created; remove them so the spreadsheet doesn't keep
// stale English duplicates. User-created tabs (any other title) are left alone.
const OLD_TAB_NAMES = ["Leaderboard", "Results", "All Match Bets", "All Bonus Bets", "Participants"];

async function ensureTabs(sheets: Sheets, spreadsheetId: string): Promise<void> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = new Map((meta.data.sheets ?? []).map((s) => [s.properties?.title ?? "", s.properties?.sheetId]));
  const requests: object[] = [];
  for (const title of TAB_NAMES) if (!existing.has(title)) requests.push({ addSheet: { properties: { title } } });
  for (const title of OLD_TAB_NAMES) {
    const id = existing.get(title);
    if (id != null) requests.push({ deleteSheet: { sheetId: id } });
  }
  // Adds run before deletes within the batch, so at least our new tabs survive.
  if (requests.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
}

// Sheet titles contain spaces/Cyrillic — A1 ranges must single-quote them.
const a1 = (title: string, ref: string) => `'${title.replace(/'/g, "''")}'!${ref}`;

async function fullRefresh(sheets: Sheets, spreadsheetId: string, specs: SheetSpec[]) {
  await sheets.spreadsheets.values.batchClear({
    spreadsheetId,
    requestBody: { ranges: specs.map((s) => a1(s.title, "A:ZZ")) },
  });
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "RAW",
      data: specs.map((s) => ({ range: a1(s.title, "A1"), values: s.values })),
    },
  });
}

// Frozen bold dark-green header, centred data (left-aligned text columns,
// wrapped wide columns), auto-fit widths. Only formats our tabs.
async function applyFormatting(sheets: Sheets, spreadsheetId: string, specs: SheetSpec[]) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const byTitle = new Map((meta.data.sheets ?? []).map((s) => [s.properties?.title ?? "", s.properties?.sheetId]));
  const requests: object[] = [];
  for (const spec of specs) {
    const sheetId = byTitle.get(spec.title);
    if (sheetId == null) continue;
    const cols = spec.values[0]?.length ?? 1;
    requests.push(
      { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
      // Header row.
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.05, green: 0.16, blue: 0.1 },
              textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
              horizontalAlignment: "CENTER",
              verticalAlignment: "MIDDLE",
            },
          },
          fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)",
        },
      },
      // All data cells centred + middle by default.
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: cols },
          cell: { userEnteredFormat: { horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE" } },
          fields: "userEnteredFormat(horizontalAlignment,verticalAlignment)",
        },
      },
    );
    // Left-aligned text columns.
    for (const c of spec.leftCols) {
      requests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: 1, startColumnIndex: c, endColumnIndex: c + 1 },
          cell: { userEnteredFormat: { horizontalAlignment: "LEFT" } },
          fields: "userEnteredFormat.horizontalAlignment",
        },
      });
    }
    requests.push({ autoResizeDimensions: { dimensions: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: cols } } });
    // Wide list columns: clamp width and wrap instead of stretching off-screen.
    for (const c of spec.wrapCols ?? []) {
      requests.push(
        { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: c, endIndex: c + 1 }, properties: { pixelSize: 460 }, fields: "pixelSize" } },
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 1, startColumnIndex: c, endColumnIndex: c + 1 },
            cell: { userEnteredFormat: { wrapStrategy: "WRAP" } },
            fields: "userEnteredFormat.wrapStrategy",
          },
        },
      );
    }
  }
  if (requests.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
}

const homeTeam = alias(teams, "h");
const awayTeam = alias(teams, "a");

async function buildLeaderboard(): Promise<SheetSpec> {
  const [snap] = await db
    .select()
    .from(leaderboardSnapshots)
    .where(eq(leaderboardSnapshots.tournamentId, TOURNAMENT_ID))
    .orderBy(desc(leaderboardSnapshots.generatedAt))
    .limit(1);
  const header = ["Место", "Участник", "Очки", "Матчи", "Бонусы", "Плей-офф", "Ключевые бонусы", "Приз"];
  const rows = (snap?.rows as Array<Record<string, unknown>>) ?? [];
  const values = [
    header,
    ...rows.map((r, i) => {
      const pos = i + 1; // straight-through position, matches the app UI
      const total = Number(r.total_points ?? 0);
      const place = total > 0 && pos <= 3 ? MEDAL[pos - 1] : String(pos);
      // Prize by visual position (the app's rule) — the snapshot's own prize
      // field follows dense-rank places and would pay everyone 1st on a tie.
      const prize = prizeForPlace(pos)?.amount ?? 0;
      return [
        place,
        String(r.display_name ?? ""),
        String(total),
        String(r.match_points ?? 0),
        String(r.bonus_points ?? 0),
        String(r.playoff_match_points ?? 0),
        String(r.key_bonus_points ?? 0),
        prize > 0 ? RUB(prize) : "",
      ];
    }),
  ];
  return { title: "Таблица", values, leftCols: [1] };
}

async function buildResults(): Promise<SheetSpec> {
  const rows = await db
    .select({
      no: matches.fifaMatchNo,
      stage: matches.stage,
      group: matches.groupCode,
      home: homeTeam.nameRu,
      homeCode: homeTeam.code,
      away: awayTeam.nameRu,
      awayCode: awayTeam.code,
      totoHome: matchResults.totoHome,
      totoAway: matchResults.totoAway,
      status: matches.status,
      kickoff: matches.kickoffAt,
    })
    .from(matches)
    .leftJoin(homeTeam, eq(homeTeam.id, matches.homeTeamId))
    .leftJoin(awayTeam, eq(awayTeam.id, matches.awayTeamId))
    .leftJoin(matchResults, eq(matchResults.matchId, matches.id))
    .where(eq(matches.tournamentId, TOURNAMENT_ID))
    .orderBy(asc(matches.fifaMatchNo));
  const STATUS_RU: Record<string, string> = {
    SCHEDULED: "по расписанию",
    LIVE: "идёт",
    AWAITING_CONFIRM: "ждёт подтверждения",
    FINAL: "завершён",
    CANCELLED: "отменён",
  };
  const values = [
    ["№", "Стадия", "Матч", "Счёт", "Статус", "Начало (МСК)"],
    ...rows.map((r) => {
      const stage = r.stage === "GROUP" && r.group ? `Группа ${r.group}` : STAGE_RU[r.stage] ?? r.stage;
      const match =
        r.home || r.away ? `${withFlag(r.homeCode, r.home) || "—"} — ${withFlag(r.awayCode, r.away) || "—"}` : "—";
      const score = r.totoHome != null && r.totoAway != null ? `${r.totoHome}:${r.totoAway}` : "—";
      return [String(r.no), stage, match, score, STATUS_RU[r.status] ?? r.status, fmtMsk(r.kickoff)];
    }),
  ];
  return { title: "Результаты", values, leftCols: [2] };
}

async function buildAllMatchBets(): Promise<SheetSpec> {
  const rows = await db
    .select({
      name: participants.displayName,
      rosterNo: participants.rosterNo,
      no: matches.fifaMatchNo,
      home: homeTeam.nameRu,
      homeCode: homeTeam.code,
      away: awayTeam.nameRu,
      awayCode: awayTeam.code,
      predHome: matchBets.predHome,
      predAway: matchBets.predAway,
      x2: matchBets.x2,
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
  const values = [
    ["Участник", "№", "Матч", "Прогноз", "×2", "Очки"],
    ...rows.map((r) => [
      r.name,
      String(r.no),
      `${withFlag(r.homeCode, r.home) || "—"} — ${withFlag(r.awayCode, r.away) || "—"}`,
      `${r.predHome}:${r.predAway}`,
      r.x2 ? "×2" : "",
      r.points != null ? String(r.points) : "—",
    ]),
  ];
  return { title: "Ставки на матчи", values, leftCols: [0, 2] };
}

// Both bonus tabs share one load: picks (with flags + group), actual outcomes
// per category (for ✓/✗), and per-category points.
async function buildBonusSheets(): Promise<[SheetSpec, SheetSpec]> {
  const parts = await db
    .select({ id: participants.id, rosterNo: participants.rosterNo, name: participants.displayName })
    .from(participants)
    .orderBy(asc(participants.rosterNo));

  const cats = await db
    .select({ id: bonusCategories.id, name: bonusCategories.nameRu, sortOrder: bonusCategories.sortOrder })
    .from(bonusCategories)
    .where(eq(bonusCategories.tournamentId, TOURNAMENT_ID))
    .orderBy(asc(bonusCategories.sortOrder));

  const bets = await db
    .select({ id: bonusBets.id, participantId: bonusBets.participantId, categoryId: bonusBets.categoryId })
    .from(bonusBets);

  const items = await db
    .select({
      betId: bonusBetItems.bonusBetId,
      teamId: bonusBetItems.teamId,
      code: teams.code,
      name: teams.nameRu,
      group: teams.groupCode,
      player: bonusBetItems.playerName,
      pos: bonusBetItems.position,
    })
    .from(bonusBetItems)
    .leftJoin(teams, eq(teams.id, bonusBetItems.teamId));

  const outcomes = await db
    .select({ categoryId: bonusOutcomes.categoryId, teamId: bonusOutcomes.teamId, player: bonusOutcomes.playerName })
    .from(bonusOutcomes);

  const pointRows = await db
    .select({ participantId: scoreEvents.participantId, categoryId: scoreEvents.categoryId, points: scoreEvents.points })
    .from(scoreEvents)
    .where(eq(scoreEvents.source, "BONUS"));

  interface Pick { teamId: string | null; code: string | null; name: string | null; group: string | null; player: string | null; pos: number }
  const picksByBet = new Map<string, Pick[]>();
  for (const it of [...items].sort((a, b) => a.pos - b.pos)) {
    if (!picksByBet.has(it.betId)) picksByBet.set(it.betId, []);
    picksByBet.get(it.betId)!.push(it);
  }
  // (participant, category) → betId
  const betByPartCat = new Map<string, string>();
  for (const b of bets) betByPartCat.set(`${b.participantId}:${b.categoryId}`, b.id);

  // Settled categories: actual team ids + normalized player names.
  const actualTeams = new Map<string, Set<string>>();
  const actualPlayers = new Map<string, Set<string>>();
  for (const o of outcomes) {
    if (o.teamId) {
      if (!actualTeams.has(o.categoryId)) actualTeams.set(o.categoryId, new Set());
      actualTeams.get(o.categoryId)!.add(o.teamId);
    }
    if (o.player) {
      if (!actualPlayers.has(o.categoryId)) actualPlayers.set(o.categoryId, new Set());
      actualPlayers.get(o.categoryId)!.add(normalizePlayerName(o.player));
    }
  }
  const isSettled = (cid: string) => actualTeams.has(cid) || actualPlayers.has(cid);

  const pointsMap = new Map<string, number>();
  for (const p of pointRows) if (p.categoryId) pointsMap.set(`${p.participantId}:${p.categoryId}`, p.points);

  // Tick a pick against the settled outcome (✓/✗), or "" if not settled.
  const tick = (cid: string, pick: Pick): string => {
    if (!isSettled(cid)) return "";
    const hit = pick.teamId
      ? actualTeams.get(cid)?.has(pick.teamId)
      : pick.player
        ? actualPlayers.get(cid)?.has(normalizePlayerName(pick.player))
        : false;
    return hit ? " ✓" : " ✗";
  };
  const renderPick = (cid: string, pick: Pick): string =>
    (pick.teamId ? withFlag(pick.code, pick.name) : pick.player ?? "") + tick(cid, pick);
  const ptsCell = (pid: string, cid: string): string => {
    const v = pointsMap.get(`${pid}:${cid}`);
    return v != null ? String(v) : isSettled(cid) ? "0" : "—";
  };

  // --- Group winners grid: участник × группы A..L ---
  const gwHeader = ["Участник", ...GROUP_CODES.map((g) => `Группа ${g}`), "Очки"];
  const gwValues = [
    gwHeader,
    ...parts.map((p) => {
      const betId = betByPartCat.get(`${p.id}:GROUP_WINNER`);
      const cells = new Map<string, string>();
      for (const pick of betId ? picksByBet.get(betId) ?? [] : []) {
        if (pick.group) cells.set(pick.group, renderPick("GROUP_WINNER", pick));
      }
      return [p.name, ...GROUP_CODES.map((g) => cells.get(g) ?? ""), ptsCell(p.id, "GROUP_WINNER")];
    }),
  ];
  const groupWinners: SheetSpec = { title: "Победители групп", values: gwValues, leftCols: [0] };

  // --- Other 6 categories as a list ---
  const otherCats = cats.filter((c) => c.id !== "GROUP_WINNER");
  const otherRows: string[][] = [];
  for (const p of parts) {
    for (const c of otherCats) {
      const betId = betByPartCat.get(`${p.id}:${c.id}`);
      if (!betId) continue; // skip categories this participant didn't fill
      const picks = picksByBet.get(betId) ?? [];
      otherRows.push([p.name, c.name, picks.map((pk) => renderPick(c.id, pk)).join(", "), ptsCell(p.id, c.id)]);
    }
  }
  const other: SheetSpec = {
    title: "Бонусы",
    values: [["Участник", "Категория", "Прогноз", "Очки"], ...otherRows],
    leftCols: [0, 1, 2],
    wrapCols: [2],
  };

  return [groupWinners, other];
}

async function buildParticipants(): Promise<SheetSpec> {
  const rows = await db
    .select({ rosterNo: participants.rosterNo, name: participants.displayName, status: participants.status, userId: participants.userId })
    .from(participants)
    .orderBy(asc(participants.rosterNo));
  const STATUS_RU: Record<string, string> = { ACTIVE: "активен", WITHDRAWN: "выбыл" };
  const values = [
    ["№", "Участник", "Статус", "Привязан"],
    ...rows.map((r) => [String(r.rosterNo), r.name, STATUS_RU[r.status] ?? r.status, r.userId ? "✓" : "—"]),
  ];
  return { title: "Участники", values, leftCols: [1] };
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

    const [leaderboard, results, allMatchBets, [groupWinners, otherBonuses], parts] = await Promise.all([
      buildLeaderboard(),
      buildResults(),
      buildAllMatchBets(),
      buildBonusSheets(),
      buildParticipants(),
    ]);

    // Order matches TAB_NAMES.
    const specs: SheetSpec[] = [leaderboard, results, allMatchBets, groupWinners, otherBonuses, parts];
    await fullRefresh(sheets, spreadsheetId, specs);
    await applyFormatting(sheets, spreadsheetId, specs);

    totalRows = specs.reduce((n, s) => n + s.values.length, 0);
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

/** Fire-and-forget export (after admin recompute). No-op if Sheets isn't configured. */
export function exportSheetsInBackground(): void {
  if (!env.googleSaJson || !env.sheetId) return;
  runSheetsExport("FULL").catch((e) =>
    console.error("background sheets export failed:", e instanceof Error ? e.message : e),
  );
}
