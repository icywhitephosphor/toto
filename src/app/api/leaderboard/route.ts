// GET /api/leaderboard — current ranked standings (06 §3.11). Returns the latest
// leaderboard_snapshots row; if none exists yet (before any recompute), computes
// a zero-state table so all 21 participants are listed from day one. Public;
// suitable for SWR polling at ~20–30 s (10 §2).
import { desc, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { route, ok } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { db } from "@/db";
import { leaderboardSnapshots } from "@/db/schema";
import { buildLeaderboardRows, type LeaderboardRow, type StandingRow } from "@/lib/leaderboard";
import { loadLiveBlock } from "@/lib/liveOverlay";
import { TOURNAMENT_ID } from "@/lib/env";

/** Per-participant points sliced by bet category, for the table filter chips
 *  (Точный счёт / Исход / Х2 / Группы / Плей-офф). One aggregate over
 *  score_events; x2 sums can go negative (playoff x2 miss = −exact). */
async function loadFacets(): Promise<Record<string, { exact: number; outcome: number; x2: number; group: number; playoff: number }>> {
  const raw = await db.execute(sql`
    SELECT se.participant_id,
      COALESCE(SUM(se.points) FILTER (WHERE (se.detail->>'exact')::boolean), 0) AS exact_pts,
      COALESCE(SUM(se.points) FILTER (WHERE (se.detail->>'outcome')::boolean
        AND NOT COALESCE((se.detail->>'exact')::boolean, false)), 0) AS outcome_pts,
      COALESCE(SUM(se.points) FILTER (WHERE (se.detail->>'x2')::boolean), 0) AS x2_pts,
      COALESCE(SUM(se.points) FILTER (WHERE m.stage = 'GROUP'), 0) AS group_pts,
      COALESCE(SUM(se.points) FILTER (WHERE m.stage <> 'GROUP'), 0) AS playoff_pts
    FROM score_events se
    JOIN matches m ON m.id = se.match_id
    WHERE se.source = 'MATCH'
    GROUP BY se.participant_id
  `);
  const facets: Record<string, { exact: number; outcome: number; x2: number; group: number; playoff: number }> = {};
  for (const r of raw as unknown as Record<string, unknown>[]) {
    facets[String(r.participant_id)] = {
      exact: Number(r.exact_pts),
      outcome: Number(r.outcome_pts),
      x2: Number(r.x2_pts),
      group: Number(r.group_pts),
      playoff: Number(r.playoff_pts),
    };
  }
  return facets;
}

export const GET = route(async (req) => {
  enforceRateLimit(req, "general");

  const [snapshot] = await db
    .select()
    .from(leaderboardSnapshots)
    .where(eq(leaderboardSnapshots.tournamentId, TOURNAMENT_ID))
    .orderBy(desc(leaderboardSnapshots.generatedAt))
    .limit(1);

  if (snapshot) {
    const rows = snapshot.rows as LeaderboardRow[];
    return ok({
      generated_at: snapshot.generatedAt.toISOString(),
      reason: snapshot.reason,
      rows,
      facets: await loadFacets(),
      // Provisional in-play overlay (display only; empty when nothing is live).
      live: await loadLiveBlock(rows),
    });
  }

  // Zero-state: no recompute has run yet.
  const standingsRaw = await db.execute(sql`SELECT * FROM v_standings`);
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

  const rows = buildLeaderboardRows(standings, new Map(), new Set());
  return ok({ generated_at: null, reason: null, rows, facets: {}, live: await loadLiveBlock(rows) });
});
