// Always-on worker (02 §6, 13). Responsibilities:
//   • Deadline reminders: DM claimed users who have NOT bet on an upcoming match,
//     once per 6h / 3h / 1h / 15m bucket before its deadline. (No bet by the
//     deadline already scores 0 — enforced by the scoring engine, 05 §3.)
//   • Scheduled Google Sheets full-refresh (when configured).
//   • Daily idempotency-key purge.
// dotenv MUST load before any module that reads env. Bundled for prod via
// `npm run build:worker` → dist/worker.cjs.
import "dotenv/config";
import cron from "node-cron";
import { and, eq, gt, inArray, isNotNull, lt, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { env } from "@/lib/env";
import { runSheetsExport } from "@/lib/sheets";
import { syncFootballData } from "@/lib/provider/sync";
import { db } from "@/db";
import { matches, matchBets, participants, users, teams, notificationLog, idempotencyKeys } from "@/db/schema";

function log(msg: string) {
  console.log(`[worker ${new Date().toISOString()}] ${msg}`);
}

const sheetsConfigured = env.googleSaJson != null && env.sheetId != null;
const botConfigured = (process.env.BOT_TOKEN ?? "").length > 0;
const feedConfigured = env.fdToken != null;

log(`starting. sheets=${sheetsConfigured ? "on" : "off"} reminders=${botConfigured ? "on" : "off"} feed=${feedConfigured ? "on" : "off (Phase 2)"}`);

// ---- Deadline reminders ----------------------------------------------------
const THRESHOLD_LABEL: Record<number, string> = { 360: "6 часов", 180: "3 часа", 60: "1 час", 15: "15 минут" };

/** The reminder bucket for the minutes remaining, or null if >6h / past. */
function currentThreshold(minutesLeft: number): number | null {
  if (minutesLeft <= 0) return null;
  if (minutesLeft <= 15) return 15;
  if (minutesLeft <= 60) return 60;
  if (minutesLeft <= 180) return 180;
  if (minutesLeft <= 360) return 360;
  return null;
}

type SendOutcome = "sent" | "blocked" | "transient";

async function tgSend(chatId: number, text: string): Promise<SendOutcome> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    if (res.ok) return "sent";
    // 403 = user blocked the bot or never pressed Start; 400 = chat not found /
    // deactivated. Neither clears on retry, so this bucket is permanently done.
    if (res.status === 403 || res.status === 400) return "blocked";
    return "transient"; // 429 rate-limit, 5xx, etc. — worth retrying next tick
  } catch {
    return "transient"; // network blip — retry
  }
}

const homeTeam = alias(teams, "rh");
const awayTeam = alias(teams, "ra");

async function runReminders(): Promise<void> {
  const now = Date.now();
  const windowEnd = new Date(now + 6 * 3600_000 + 10 * 60_000);

  const upcoming = await db
    .select({ id: matches.id, deadlineAt: matches.deadlineAt, home: homeTeam.nameRu, away: awayTeam.nameRu })
    .from(matches)
    .leftJoin(homeTeam, eq(homeTeam.id, matches.homeTeamId))
    .leftJoin(awayTeam, eq(awayTeam.id, matches.awayTeamId))
    .where(
      and(
        isNotNull(matches.deadlineAt),
        gt(matches.deadlineAt, new Date(now)),
        lt(matches.deadlineAt, windowEnd),
        ne(matches.status, "CANCELLED"),
      ),
    );
  if (upcoming.length === 0) return;

  const matchIds = upcoming.map((m) => m.id);
  const parts = await db
    .select({ pid: participants.id, tg: users.telegramId })
    .from(participants)
    .innerJoin(users, eq(users.id, participants.userId))
    .where(eq(participants.status, "ACTIVE"));
  if (parts.length === 0) return;

  const bets = await db
    .select({ pid: matchBets.participantId, mid: matchBets.matchId })
    .from(matchBets)
    .where(inArray(matchBets.matchId, matchIds));
  const betSet = new Set(bets.map((b) => `${b.pid}:${b.mid}`));

  const logs = await db.select().from(notificationLog).where(inArray(notificationLog.matchId, matchIds));
  const logSet = new Set(logs.map((l) => `${l.matchId}:${l.participantId}:${l.thresholdMin}`));

  let sent = 0;
  for (const m of upcoming) {
    const minutesLeft = (new Date(m.deadlineAt!).getTime() - now) / 60_000;
    const t = currentThreshold(minutesLeft);
    if (t === null) continue;
    for (const p of parts) {
      if (betSet.has(`${p.pid}:${m.id}`)) continue; // already has a bet
      const key = `${m.id}:${p.pid}:${t}`;
      if (logSet.has(key)) continue; // already reminded for this bucket
      const text = `⏰ Ставки на матч <b>${m.home ?? "?"} — ${m.away ?? "?"}</b> закроются примерно через ${THRESHOLD_LABEL[t]}, а прогноза ещё нет. Открой ТОТО и поставь!`;
      const outcome = await tgSend(p.tg, text);
      // A transient failure (rate-limit, 5xx, network) must NOT be recorded —
      // otherwise this bucket is suppressed forever and the user is never
      // reminded. Only a real send or a permanent block is final; record those
      // so we don't re-DM a user who got it (or can't get it).
      if (outcome === "transient") continue;
      await db.insert(notificationLog).values({ matchId: m.id, participantId: p.pid, thresholdMin: t }).onConflictDoNothing();
      logSet.add(key);
      if (outcome === "sent") sent += 1;
    }
  }
  if (sent > 0) log(`deadline reminders sent: ${sent}`);
}

if (botConfigured) {
  cron.schedule("*/2 * * * *", () => {
    runReminders().catch((err) => log(`reminders FAILED: ${err instanceof Error ? err.message : String(err)}`));
  });
}

// ---- Scheduled Google Sheets export ----------------------------------------
if (sheetsConfigured) {
  cron.schedule("*/10 * * * *", async () => {
    try {
      const r = await runSheetsExport("FULL");
      log(`sheets export ok: ${r.rowsWritten} rows`);
    } catch (err) {
      log(`sheets export FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  // Populate the sheet immediately on boot (don't wait for the first 10-min tick).
  runSheetsExport("FULL")
    .then((r) => log(`startup sheets export: ${r.rowsWritten} rows`))
    .catch((err) => log(`startup sheets export FAILED: ${err instanceof Error ? err.message : String(err)}`));
}

// ---- Daily idempotency-key purge (their 24h replay window; 06 §4) ----------
cron.schedule("17 4 * * *", async () => {
  try {
    await db.delete(idempotencyKeys).where(lt(idempotencyKeys.createdAt, new Date(Date.now() - 24 * 3600_000)));
    log("idempotency keys older than 24h purged");
  } catch (err) {
    log(`idempotency purge FAILED: ${err instanceof Error ? err.message : String(err)}`);
  }
});

// ---- football-data.org polling ----------------------------------------------
// One API call per pass (all 104 matches). Cadence: 15s while any match is in
// a live window, otherwise sleep until ~1 min before the next kickoff (capped
// at 10 min). Free tier allows 10 calls/min; 15s polling uses 4. The response's
// x-requests-available-minute header additionally throttles us near the limit.
if (feedConfigured) {
  const IDLE_MS = 10 * 60_000;
  const LIVE_MS = 15_000;
  const loop = async () => {
    let next = IDLE_MS;
    try {
      const out = await syncFootballData(log);
      if (!out.ok) {
        log(`fd sync failed: ${out.error ?? `HTTP ${out.httpStatus}`}`);
        next = out.httpStatus === 429 ? 70_000 : 60_000;
      } else {
        if (out.fixturesUpdated || out.resultsApplied || out.liveUpdated || out.unmatched) {
          log(`fd sync: fixtures=${out.fixturesUpdated} results=${out.resultsApplied} live=${out.liveUpdated} unmatched=${out.unmatched}`);
        }
        if (out.liveNow) next = LIVE_MS;
        else if (out.awaitingScore > 0) next = 60_000; // finished, score pending — hammer
        else if (out.msToNextKickoff != null) {
          next = Math.min(IDLE_MS, Math.max(LIVE_MS, out.msToNextKickoff - 60_000));
        }
      }
      if (out.quotaRemaining != null && out.quotaRemaining <= 1) next = Math.max(next, 65_000);
    } catch (err) {
      log(`fd sync crashed: ${err instanceof Error ? err.message : String(err)}`);
      next = 60_000;
    }
    setTimeout(loop, next);
  };
  setTimeout(loop, 5_000);
  log("football-data polling enabled: 15s in live windows, otherwise until next kickoff (≤10m)");
}

// Keep the process alive even if no cron jobs were scheduled.
setInterval(() => {}, 1 << 30);

process.on("SIGTERM", () => {
  log("SIGTERM received, shutting down.");
  process.exit(0);
});
process.on("SIGINT", () => process.exit(0));
