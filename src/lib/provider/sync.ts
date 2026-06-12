// One football-data.org sync pass (08): refresh fixtures (kickoff/deadline),
// link provider match ids, apply FINISHED results, recompute when scoring
// inputs changed. Called from the worker on a dynamic cadence.
//
// Safety rules:
//   • a deadline that has already passed is NEVER moved (bets are revealed
//     after the deadline — moving it would reopen a revealed market);
//   • deadlines are only (re)set for matches whose both teams are known;
//   • ADMIN-sourced or confirmed results are never overwritten;
//   • group results auto-confirm (auto-scoring), play-off results land as
//     AWAITING_CONFIRM for the admin (×2 + penalty stakes are too high).
import { eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { matches, matchResults, teams, providerSyncLog } from "@/db/schema";
import { TOURNAMENT_ID } from "@/lib/env";
import { recomputeAll } from "@/lib/recompute";
import { exportSheetsInBackground } from "@/lib/sheets";
import { totoScore } from "@/scoring";
import {
  fetchWcMatches,
  FD_STAGE_TO_LOCAL,
  fdCode,
  mapFinishedScore,
  type FdMatch,
  type MappedResult,
} from "./footballData";
import { fetchWc26Scores } from "./worldcup26";

const LEAD_MS = 3 * 3600_000;
const pairKey = (a: string, b: string) => [a, b].sort().join("|");

export interface SyncOutcome {
  ok: boolean;
  httpStatus: number | null;
  fixturesUpdated: number;
  resultsApplied: number;
  liveUpdated: number;
  unmatched: number;
  liveNow: boolean;
  /** FINISHED matches whose score the provider hasn't published yet — keep
   *  retrying on a tight cadence so points land the moment it appears. */
  awaitingScore: number;
  msToNextKickoff: number | null;
  quotaRemaining: number | null;
  error?: string;
}

const homeTeam = alias(teams, "sync_home");
const awayTeam = alias(teams, "sync_away");

async function loadLocal() {
  return db
    .select({
      id: matches.id,
      fifaMatchNo: matches.fifaMatchNo,
      stage: matches.stage,
      groupCode: matches.groupCode,
      kickoffAt: matches.kickoffAt,
      deadlineAt: matches.deadlineAt,
      providerMatchId: matches.providerMatchId,
      homeTeamId: matches.homeTeamId,
      awayTeamId: matches.awayTeamId,
      homeCode: homeTeam.code,
      awayCode: awayTeam.code,
      resultStatus: matchResults.resultStatus,
      resultSource: matchResults.source,
      resultConfirmed: matchResults.confirmed,
      resultUpdatedBy: matchResults.updatedBy,
      resultBaseHome: matchResults.baseHome,
      resultBaseAway: matchResults.baseAway,
      resultPenHome: matchResults.penHome,
      resultPenAway: matchResults.penAway,
    })
    .from(matches)
    .leftJoin(homeTeam, eq(homeTeam.id, matches.homeTeamId))
    .leftJoin(awayTeam, eq(awayTeam.id, matches.awayTeamId))
    .leftJoin(matchResults, eq(matchResults.matchId, matches.id))
    .where(eq(matches.tournamentId, TOURNAMENT_ID));
}

type Local = Awaited<ReturnType<typeof loadLocal>>[number];

// Any human-touched result is off-limits to every provider: an explicit ADMIN
// source, a confirmed result, OR a non-null updatedBy (an admin saved it even
// with source=PROVIDER and left it unconfirmed). Confirmed group results also
// land here, which makes the first provider to publish a score the winner —
// later providers can never flip-flop it.
function isAdminOwned(m: Local): boolean {
  return (
    m.resultStatus != null &&
    (m.resultSource === "ADMIN" || m.resultConfirmed === true || m.resultUpdatedBy != null)
  );
}

/** Upsert a LIVE score row (display only — scoring ignores non-finals). */
async function writeLive(m: Local, home: number, away: number, payload: unknown): Promise<boolean> {
  const sameLive = m.resultStatus === "LIVE" && m.resultBaseHome === home && m.resultBaseAway === away;
  if (sameLive) return false;
  const liveValues = {
    matchId: m.id,
    resultStatus: "LIVE",
    baseHome: home,
    baseAway: away,
    penHome: null,
    penAway: null,
    totoHome: home,
    totoAway: away,
    winnerTeamId: null,
    source: "PROVIDER",
    confirmed: false,
    providerPayload: payload,
    updatedBy: null,
    updatedAt: new Date(),
  };
  await db.transaction(async (tx) => {
    await tx.insert(matchResults).values(liveValues).onConflictDoUpdate({ target: matchResults.matchId, set: liveValues });
    await tx.update(matches).set({ status: "LIVE", updatedAt: new Date() }).where(eq(matches.id, m.id));
  });
  return true;
}

/** Upsert a final result. `usable` = it feeds scoring (auto-confirmed group). */
async function writeFinal(
  m: Local,
  mapped: MappedResult,
  payload: unknown,
  log: (msg: string) => void,
): Promise<{ wrote: boolean; usable: boolean }> {
  const same =
    m.resultStatus === mapped.resultStatus &&
    m.resultBaseHome === mapped.baseHome &&
    m.resultBaseAway === mapped.baseAway &&
    m.resultPenHome === mapped.penHome &&
    m.resultPenAway === mapped.penAway;
  if (same) return { wrote: false, usable: false };

  const toto = totoScore({
    baseHome: mapped.baseHome,
    baseAway: mapped.baseAway,
    penHome: mapped.penHome,
    penAway: mapped.penAway,
  });
  const isGroup = m.stage === "GROUP";
  const winnerTeamId =
    toto.home > toto.away ? m.homeTeamId : toto.away > toto.home ? m.awayTeamId : null;
  const values = {
    matchId: m.id,
    resultStatus: mapped.resultStatus,
    baseHome: mapped.baseHome,
    baseAway: mapped.baseAway,
    penHome: mapped.penHome,
    penAway: mapped.penAway,
    totoHome: toto.home,
    totoAway: toto.away,
    winnerTeamId,
    source: "PROVIDER",
    confirmed: isGroup,
    providerPayload: payload,
    updatedBy: null,
    updatedAt: new Date(),
  };
  await db.transaction(async (tx) => {
    await tx.insert(matchResults).values(values).onConflictDoUpdate({ target: matchResults.matchId, set: values });
    await tx
      .update(matches)
      .set({ status: isGroup ? "FINAL" : "AWAITING_CONFIRM", updatedAt: new Date() })
      .where(eq(matches.id, m.id));
  });
  log(`result: №${m.fifaMatchNo} ${mapped.resultStatus} ${mapped.baseHome}:${mapped.baseAway}${isGroup ? "" : " (ждёт подтверждения админом)"}`);
  return { wrote: true, usable: isGroup };
}

function findLocal(fd: FdMatch, ctx: {
  byProviderId: Map<string, Local>;
  byPair: Map<string, Local>;
  byStageTime: Map<string, Local[]>;
}): Local | null {
  const linked = ctx.byProviderId.get(String(fd.id));
  if (linked) return linked;
  const stage = FD_STAGE_TO_LOCAL[fd.stage];
  if (!stage) return null;
  const h = fdCode(fd.homeTeam.tla);
  const a = fdCode(fd.awayTeam.tla);
  if (h && a) {
    const found = ctx.byPair.get(`${stage}|${pairKey(h, a)}`);
    if (found) return found;
  }
  // Time fallback ONLY for a still-undrawn knockout fixture (FD hasn't named
  // the teams either). byStageTime contains only unresolved, unlinked local
  // matches, so two pairs sharing a kickoff give >1 candidate → we bail rather
  // than risk linking the wrong fixture. Once linked, the provider id is stable
  // and this heuristic never runs for that match again.
  if (h || a) return null;
  const candidates = ctx.byStageTime.get(`${stage}|${new Date(fd.utcDate).getTime()}`) ?? [];
  return candidates.length === 1 ? candidates[0] : null;
}

export async function syncFootballData(log: (msg: string) => void): Promise<SyncOutcome> {
  const startedAt = new Date();
  const fetched = await fetchWcMatches();

  const outcome: SyncOutcome = {
    ok: false,
    httpStatus: fetched.httpStatus,
    fixturesUpdated: 0,
    resultsApplied: 0,
    liveUpdated: 0,
    unmatched: 0,
    liveNow: false,
    awaitingScore: 0,
    msToNextKickoff: null,
    quotaRemaining: fetched.quotaRemaining,
    error: fetched.error,
  };

  try {
    if (!fetched.matches) return outcome;

    const local = await loadLocal();
    const byProviderId = new Map<string, Local>();
    const byPair = new Map<string, Local>();
    const byStageTime = new Map<string, Local[]>();
    for (const m of local) {
      if (m.providerMatchId) byProviderId.set(m.providerMatchId, m);
      if (m.homeCode && m.awayCode) byPair.set(`${m.stage}|${pairKey(m.homeCode, m.awayCode)}`, m);
      // Time index holds ONLY unresolved, unlinked fixtures — a match that is
      // already linked or has both teams must never be reachable via the time
      // heuristic (see findLocal).
      if (m.kickoffAt && !m.providerMatchId && !(m.homeCode && m.awayCode)) {
        const k = `${m.stage}|${m.kickoffAt.getTime()}`;
        if (!byStageTime.has(k)) byStageTime.set(k, []);
        byStageTime.get(k)!.push(m);
      }
    }

    const now = Date.now();
    let usableResults = 0;

    for (const fd of fetched.matches) {
      if (fd.status === "IN_PLAY" || fd.status === "PAUSED") outcome.liveNow = true;
      const kickMs = new Date(fd.utcDate).getTime();
      // Kicked off recently but not finished (FD can lag flipping to IN_PLAY):
      // still a live window, keep polling fast.
      if (
        kickMs <= now &&
        now - kickMs < 4 * 3600_000 &&
        !["FINISHED", "CANCELLED", "POSTPONED", "SUSPENDED", "AWARDED"].includes(fd.status)
      ) {
        outcome.liveNow = true;
      }
      if (kickMs > now && ["TIMED", "SCHEDULED"].includes(fd.status)) {
        const dt = kickMs - now;
        if (outcome.msToNextKickoff === null || dt < outcome.msToNextKickoff) outcome.msToNextKickoff = dt;
      }

      const m = findLocal(fd, { byProviderId, byPair, byStageTime });
      if (!m) {
        outcome.unmatched += 1;
        // A FINISHED match we can't map usually means an unknown FD team code
        // (alias gap) — log its identity so it can be fixed quickly.
        if (fd.status === "FINISHED") {
          log(`unmatched FINISHED: ${fd.stage} ${fd.homeTeam.tla ?? "?"}-${fd.awayTeam.tla ?? "?"} @ ${fd.utcDate} (fd#${fd.id})`);
        }
        continue;
      }

      // --- fixture refresh -------------------------------------------------
      const matchPatch: Record<string, unknown> = {};
      if (m.providerMatchId !== String(fd.id)) matchPatch.providerMatchId = String(fd.id);

      const fdKick = new Date(fd.utcDate);
      if (!m.kickoffAt || m.kickoffAt.getTime() !== fdKick.getTime()) {
        matchPatch.kickoffAt = fdKick;
        log(`fixture: №${m.fifaMatchNo} kickoff ${m.kickoffAt?.toISOString() ?? "null"} → ${fd.utcDate}`);
      }
      const teamsKnown = m.homeTeamId != null && m.awayTeamId != null;
      const newDeadline = new Date(fdKick.getTime() - LEAD_MS);
      const deadlinePassed = m.deadlineAt != null && m.deadlineAt.getTime() <= now;
      if (teamsKnown && !deadlinePassed && (m.deadlineAt?.getTime() ?? -1) !== newDeadline.getTime()) {
        matchPatch.deadlineAt = newDeadline;
      }
      if (Object.keys(matchPatch).length > 0) {
        matchPatch.updatedAt = new Date();
        await db.update(matches).set(matchPatch).where(eq(matches.id, m.id));
        if (matchPatch.kickoffAt || matchPatch.deadlineAt) outcome.fixturesUpdated += 1;
      }

      // --- result ingest ---------------------------------------------------
      // Orientation: detect a swap from EITHER known side, not just home, so a
      // fixture we know only by one team is still oriented correctly.
      const fdHome = fdCode(fd.homeTeam.tla);
      const fdAway = fdCode(fd.awayTeam.tla);
      const swapped =
        (m.homeCode != null && fdHome != null && fdHome !== m.homeCode) ||
        (m.awayCode != null && fdAway != null && fdAway !== m.awayCode);
      // Sanity: when both our teams are known, FD's pair must equal ours in one
      // of the two orientations. If not, findLocal matched the wrong fixture —
      // refuse to write anything rather than score the wrong match.
      if (teamsKnown && fdHome && fdAway) {
        const ours = new Set([m.homeCode, m.awayCode]);
        if (!ours.has(fdHome) || !ours.has(fdAway)) {
          log(`orientation mismatch: №${m.fifaMatchNo} ours ${m.homeCode}-${m.awayCode} vs fd ${fdHome}-${fdAway} — skipped`);
          continue;
        }
      }

      const adminOwned = isAdminOwned(m);

      // Live passthrough: a running match with published numbers is stored as a
      // LIVE result row — display only, the scoring engine ignores everything
      // that isn't FT/AET/PEN. Overwritten by the final result when it lands.
      if ((fd.status === "IN_PLAY" || fd.status === "PAUSED") && teamsKnown && !adminOwned) {
        const ft = fd.score.fullTime;
        if (ft.home != null && ft.away != null) {
          const lh = swapped ? ft.away : ft.home;
          const la = swapped ? ft.home : ft.away;
          if (await writeLive(m, lh, la, fd.score)) outcome.liveUpdated += 1;
        }
        continue;
      }

      const mapped = mapFinishedScore(fd, swapped);
      if (!mapped) {
        // FINISHED but the provider hasn't published the numbers (free-tier
        // delay) or the payload is incomplete — count it so the worker retries
        // on a tight cadence, and surface it for a possible manual entry.
        if (fd.status === "FINISHED" && !adminOwned) {
          outcome.awaitingScore += 1;
          log(`result pending: №${m.fifaMatchNo} FINISHED but provider has no score yet`);
        }
        continue;
      }
      if (!teamsKnown || adminOwned) continue;
      const w = await writeFinal(m, mapped, fd.score, log);
      if (w.wrote) outcome.resultsApplied += 1;
      if (w.usable) usableResults += 1;
    }

    if (usableResults > 0) {
      await recomputeAll(`football-data: +${usableResults} результат(ов)`, null);
      // Refresh the Google Sheet now instead of waiting for the 10-min cron
      // (no-op if Sheets isn't configured).
      exportSheetsInBackground();
    }

    outcome.ok = true;
    return outcome;
  } catch (err) {
    outcome.error = err instanceof Error ? err.message : String(err);
    return outcome;
  } finally {
    try {
      await db.insert(providerSyncLog).values({
        provider: "football-data.org",
        endpoint: "/v4/competitions/WC/matches",
        httpStatus: outcome.httpStatus,
        items: fetched.matches?.length ?? null,
        ok: outcome.ok,
        error: outcome.error ?? null,
        quotaRemaining: outcome.quotaRemaining,
        startedAt,
        finishedAt: new Date(),
      });
    } catch {
      /* sync logging must never break the sync itself */
    }
  }
}

/**
 * worldcup26.ir pass — the free LIVE-score + group-result source. Runs after
 * the FD pass each tick. Matching is by stage + team pair ONLY (their match
 * ids do not follow FIFA numbering). Group finals auto-confirm and recompute;
 * play-off games get live display only (no extra-time/penalty split in their
 * payload — FD/admin finalizes those). isAdminOwned/writeFinal make the first
 * publisher win: once a group result is confirmed, nobody overwrites it.
 */
export async function syncWorldcup26(log: (msg: string) => void): Promise<SyncOutcome> {
  const startedAt = new Date();
  const fetched = await fetchWc26Scores();

  const outcome: SyncOutcome = {
    ok: false,
    httpStatus: fetched.httpStatus,
    fixturesUpdated: 0,
    resultsApplied: 0,
    liveUpdated: 0,
    unmatched: 0,
    liveNow: false,
    awaitingScore: 0,
    msToNextKickoff: null,
    quotaRemaining: null,
    error: fetched.error,
  };

  try {
    if (!fetched.ok) return outcome;

    const local = await loadLocal();
    const byPair = new Map<string, Local>();
    for (const m of local) {
      if (m.homeCode && m.awayCode) byPair.set(`${m.stage}|${pairKey(m.homeCode, m.awayCode)}`, m);
    }

    const now = Date.now();
    let usable = 0;

    for (const s of fetched.scores) {
      const m = byPair.get(`${s.stage}|${pairKey(s.homeCode, s.awayCode)}`);
      if (!m) {
        outcome.unmatched += 1;
        continue;
      }
      // Orientation per match: our home must be one of the two (pair already
      // matched), so a simple home-code comparison decides the swap.
      const swapped = m.homeCode !== s.homeCode;
      const home = swapped ? s.away : s.home;
      const away = swapped ? s.home : s.away;
      if (isAdminOwned(m)) continue;

      const kickoffPassed = m.kickoffAt != null && m.kickoffAt.getTime() <= now;
      if (s.finished && s.stage === "GROUP") {
        const w = await writeFinal(
          m,
          { resultStatus: "FT", baseHome: home, baseAway: away, penHome: null, penAway: null },
          { wc26: s },
          log,
        );
        if (w.wrote) outcome.resultsApplied += 1;
        if (w.usable) usable += 1;
      } else if (kickoffPassed) {
        // In play (or a finished play-off awaiting its official breakdown):
        // keep the latest score visible.
        if (!s.finished) outcome.liveNow = true;
        if (await writeLive(m, home, away, { wc26: s })) outcome.liveUpdated += 1;
      }
    }

    if (usable > 0) {
      await recomputeAll(`worldcup26: +${usable} результат(ов)`, null);
      exportSheetsInBackground();
    }

    outcome.ok = true;
    return outcome;
  } catch (err) {
    outcome.error = err instanceof Error ? err.message : String(err);
    return outcome;
  } finally {
    try {
      await db.insert(providerSyncLog).values({
        provider: "worldcup26.ir",
        endpoint: "/get/games",
        httpStatus: outcome.httpStatus,
        items: fetched.scores.length,
        ok: outcome.ok,
        error: outcome.error ?? null,
        quotaRemaining: null,
        startedAt,
        finishedAt: new Date(),
      });
    } catch {
      /* sync logging must never break the sync itself */
    }
  }
}
