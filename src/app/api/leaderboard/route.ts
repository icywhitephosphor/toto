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
import { buildLeaderboardRows, type StandingRow } from "@/lib/leaderboard";
import { TOURNAMENT_ID } from "@/lib/env";

export const GET = route(async (req) => {
  enforceRateLimit(req, "general");

  const [snapshot] = await db
    .select()
    .from(leaderboardSnapshots)
    .where(eq(leaderboardSnapshots.tournamentId, TOURNAMENT_ID))
    .orderBy(desc(leaderboardSnapshots.generatedAt))
    .limit(1);

  if (snapshot) {
    return ok({
      generated_at: snapshot.generatedAt.toISOString(),
      reason: snapshot.reason,
      rows: snapshot.rows,
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
  return ok({ generated_at: null, reason: null, rows });
});
