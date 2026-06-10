// The impure recompute wrapper (architecture/05 §7). The pure engine decides
// points; this orchestrator reads bets + results, writes score_events, and a
// leaderboard snapshot. It is fully idempotent: it DELETEs all score_events and
// re-inserts from current state, so running it N times yields the same table.
import { sql, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  participants,
  matches,
  matchResults,
  matchBets,
  bonusCategories,
  bonusBets,
  bonusBetItems,
  bonusOutcomes,
  scoreEvents,
  leaderboardSnapshots,
} from "@/db/schema";
import { scoreMatchBet, scoreBonusTeams, scoreTopScorer, outcome, type Stage } from "@/scoring";
import { buildLeaderboardRows, type StandingRow } from "./leaderboard";
import { writeAudit, type DbExecutor } from "./audit";
import { TOURNAMENT_ID } from "./env";

export interface RecomputeResult {
  scoreEventsUpserted: number;
  snapshotId: string;
  durationMs: number;
}

const PLAYOFF = new Set<Stage>(["R32", "R16", "QF", "SF", "THIRD", "FINAL"]);

export async function recomputeAll(
  reason: string,
  actorUserId: string | null = null,
  exec?: DbExecutor,
): Promise<RecomputeResult> {
  const start = Date.now();
  let snapshotId = "";
  let eventCount = 0;

  // When the caller is already inside a transaction it passes `exec` so the
  // recompute commits atomically with the result/outcome write that triggered
  // it. Standalone callers (worker, admin recompute endpoint) get their own tx.
  const run = async (tx: DbExecutor) => {
    const activeParticipants = (
      await tx
        .select({ id: participants.id, status: participants.status })
        .from(participants)
    ).filter((p) => p.status === "ACTIVE");

    // Matches whose result is "usable": GROUP needs only FT/AET/PEN; play-off
    // additionally needs confirmed=true (05 §7, 08 admin-confirm).
    const matchRows = await tx
      .select({
        id: matches.id,
        stage: matches.stage,
        resultStatus: matchResults.resultStatus,
        confirmed: matchResults.confirmed,
        totoHome: matchResults.totoHome,
        totoAway: matchResults.totoAway,
      })
      .from(matches)
      .innerJoin(matchResults, eq(matchResults.matchId, matches.id));

    const usable = matchRows.filter(
      (m) =>
        ["FT", "AET", "PEN"].includes(m.resultStatus) &&
        m.totoHome != null &&
        m.totoAway != null &&
        (m.stage === "GROUP" || m.confirmed === true),
    );

    const bets = await tx
      .select({
        participantId: matchBets.participantId,
        matchId: matchBets.matchId,
        predHome: matchBets.predHome,
        predAway: matchBets.predAway,
        x2: matchBets.x2,
      })
      .from(matchBets);
    const betMap = new Map(bets.map((b) => [`${b.participantId}:${b.matchId}`, b]));

    // Bonus categories (authoritative config from DB).
    const categories = await tx
      .select({
        id: bonusCategories.id,
        itemType: bonusCategories.itemType,
        pointsPerCorrect: bonusCategories.pointsPerCorrect,
        settlesAfterStage: bonusCategories.settlesAfterStage,
      })
      .from(bonusCategories);

    // Actual outcomes per category.
    const outcomes = await tx.select().from(bonusOutcomes);
    const actualTeamsByCat = new Map<string, Set<string>>();
    const actualPlayerByCat = new Map<string, string>();
    const settledCategories = new Set<string>();
    for (const o of outcomes) {
      settledCategories.add(o.categoryId);
      if (o.teamId) {
        if (!actualTeamsByCat.has(o.categoryId)) actualTeamsByCat.set(o.categoryId, new Set());
        actualTeamsByCat.get(o.categoryId)!.add(o.teamId);
      } else if (o.playerName) {
        actualPlayerByCat.set(o.categoryId, o.playerName);
      }
    }

    // Predicted picks per (participant, category).
    const bbets = await tx
      .select({ id: bonusBets.id, participantId: bonusBets.participantId, categoryId: bonusBets.categoryId })
      .from(bonusBets);
    const items = await tx
      .select({ bonusBetId: bonusBetItems.bonusBetId, teamId: bonusBetItems.teamId, playerName: bonusBetItems.playerName })
      .from(bonusBetItems);
    const itemsByBet = new Map<string, { teams: Set<string>; player: string | null }>();
    for (const it of items) {
      if (!itemsByBet.has(it.bonusBetId)) itemsByBet.set(it.bonusBetId, { teams: new Set(), player: null });
      const bucket = itemsByBet.get(it.bonusBetId)!;
      if (it.teamId) bucket.teams.add(it.teamId);
      if (it.playerName) bucket.player = it.playerName;
    }
    const predictedByPartCat = new Map<string, { teams: Set<string>; player: string | null }>();
    for (const bb of bbets) {
      predictedByPartCat.set(
        `${bb.participantId}:${bb.categoryId}`,
        itemsByBet.get(bb.id) ?? { teams: new Set(), player: null },
      );
    }

    // ---- Build score_events ----
    type EventRow = typeof scoreEvents.$inferInsert;
    const rows: EventRow[] = [];

    for (const m of usable) {
      const toto = { home: m.totoHome!, away: m.totoAway! };
      const stage = m.stage as Stage;
      for (const p of activeParticipants) {
        const bet = betMap.get(`${p.id}:${m.id}`);
        const matchBet = bet ? { predHome: bet.predHome, predAway: bet.predAway, x2: bet.x2 } : null;
        const points = scoreMatchBet(stage, matchBet, toto);
        const detail = bet
          ? {
              pred: [bet.predHome, bet.predAway],
              toto: [toto.home, toto.away],
              x2: bet.x2 && PLAYOFF.has(stage),
              exact: bet.predHome === toto.home && bet.predAway === toto.away,
              outcome: outcome(bet.predHome, bet.predAway) === outcome(toto.home, toto.away),
            }
          : { noBet: true };
        rows.push({
          participantId: p.id,
          source: "MATCH",
          unitKey: `M:${m.id}`,
          matchId: m.id,
          stage,
          points,
          detail,
        });
      }
    }

    for (const cat of categories) {
      if (!settledCategories.has(cat.id)) continue; // not settled → contributes 0, no rows
      for (const p of activeParticipants) {
        const predicted = predictedByPartCat.get(`${p.id}:${cat.id}`) ?? { teams: new Set(), player: null };
        let points: number;
        let detail: Record<string, unknown>;
        if (cat.itemType === "PLAYER") {
          const pred = predicted.player ?? "";
          points = pred ? scoreTopScorer(pred, actualPlayerByCat.get(cat.id) ?? null, cat.pointsPerCorrect) : 0;
          detail = { player: pred, hit: points > 0 };
        } else {
          const actual = actualTeamsByCat.get(cat.id) ?? new Set<string>();
          points = scoreBonusTeams(predicted.teams, actual, cat.pointsPerCorrect);
          detail = { hits: cat.pointsPerCorrect ? points / cat.pointsPerCorrect : 0 };
        }
        rows.push({
          participantId: p.id,
          source: "BONUS",
          unitKey: `B:${cat.id}`,
          categoryId: cat.id,
          stage: cat.settlesAfterStage,
          points,
          detail,
        });
      }
    }

    // Idempotent: wipe and re-insert the whole ledger.
    await tx.delete(scoreEvents);
    if (rows.length) await tx.insert(scoreEvents).values(rows);
    eventCount = rows.length;

    // ---- Standings + snapshot ----
    const standingsRaw = await tx.execute(sql`SELECT * FROM v_standings`);
    const standings: StandingRow[] = (standingsRaw as unknown as Record<string, unknown>[]).map((r) => ({
      participantId: String(r.participant_id),
      displayName: String(r.display_name),
      totalPoints: Number(r.total_points),
      matchPoints: Number(r.match_points),
      bonusPoints: Number(r.bonus_points),
      playoffMatchPoints: Number(r.playoff_match_points),
      keyBonusPoints: Number(r.key_bonus_points),
      tiebreakRank: r.tiebreak_rank == null ? null : Number(r.tiebreak_rank),
    }));

    const bonusByParticipant = new Map<string, Map<string, number>>();
    for (const r of rows) {
      if (r.source !== "BONUS" || !r.categoryId) continue;
      if (!bonusByParticipant.has(r.participantId)) bonusByParticipant.set(r.participantId, new Map());
      bonusByParticipant.get(r.participantId)!.set(r.categoryId, r.points);
    }

    const ranked = buildLeaderboardRows(standings, bonusByParticipant, settledCategories);

    const [snap] = await tx
      .insert(leaderboardSnapshots)
      .values({ tournamentId: TOURNAMENT_ID, rows: ranked, reason })
      .returning({ id: leaderboardSnapshots.id });
    snapshotId = snap.id;

    await writeAudit(tx, {
      actorUserId,
      actorKind: actorUserId ? "ADMIN" : "SYSTEM",
      action: "RECOMPUTE",
      entityType: "tournament",
      entityId: TOURNAMENT_ID,
      after: { score_events: eventCount, snapshot_id: snapshotId, reason },
      reason,
    });
  };

  if (exec) await run(exec);
  else await db.transaction(run);

  return { scoreEventsUpserted: eventCount, snapshotId, durationMs: Date.now() - start };
}
