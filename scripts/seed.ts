// Idempotent seed for wc2026: tournament, 12 groups, 48 teams, 7 bonus
// categories, 104 matches (72 group + 32 knockout slots) and the 21-person
// roster. Upserts everywhere, so re-running never destroys participant bets.
// dotenv MUST load before importing @/db (the pool reads DATABASE_URL at import).
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  tournaments,
  groups,
  teams,
  bonusCategories,
  matches,
  participants,
} from "@/db/schema";
import { TOURNAMENT_ID } from "@/lib/env";
import { GROUP_CODES, TEAMS } from "@/domain/teams";
import { BONUS_CATEGORIES } from "@/domain/bonus";
import { KNOCKOUT_MATCHES } from "@/domain/bracket";
import { buildGroupSchedule } from "@/domain/schedule";
import { ROSTER } from "@/domain/participants";
import { PLAYOFF_STAGES } from "@/scoring";

const BONUS_DEADLINE = new Date("2026-06-10T20:00:00Z"); // 23:00 MSK
const MATCH_LEAD_MS = 3 * 3600_000; // tournaments.match_deadline_lead = 3h

async function main() {
  await db.transaction(async (tx) => {
    // 1. tournament
    await tx
      .insert(tournaments)
      .values({
        id: TOURNAMENT_ID,
        name: "FIFA World Cup 2026",
        displayTz: "Europe/Moscow",
        bonusDeadlineAt: BONUS_DEADLINE,
        matchDeadlineLead: "3 hours",
        startsAt: new Date("2026-06-11T00:00:00Z"),
        endsAt: new Date("2026-07-19T00:00:00Z"),
      })
      .onConflictDoUpdate({
        target: tournaments.id,
        set: { name: "FIFA World Cup 2026", bonusDeadlineAt: BONUS_DEADLINE },
      });

    // 2. groups A..L
    await tx
      .insert(groups)
      .values(GROUP_CODES.map((code) => ({ tournamentId: TOURNAMENT_ID, code, name: `Группа ${code}` })))
      .onConflictDoNothing();

    // 3. teams
    await tx
      .insert(teams)
      .values(
        TEAMS.map((t) => ({
          tournamentId: TOURNAMENT_ID,
          groupCode: t.groupCode,
          code: t.code,
          nameRu: t.nameRu,
          nameEn: t.nameEn,
          fifaCode: t.code,
        })),
      )
      .onConflictDoUpdate({
        target: [teams.tournamentId, teams.code],
        set: {
          nameRu: sqlExcluded("name_ru"),
          nameEn: sqlExcluded("name_en"),
          groupCode: sqlExcluded("group_code"),
        },
      });

    // 4. bonus categories
    await tx
      .insert(bonusCategories)
      .values(
        BONUS_CATEGORIES.map((c) => ({
          id: c.id,
          tournamentId: TOURNAMENT_ID,
          nameRu: c.nameRu,
          nameEn: c.nameEn,
          itemCount: c.itemCount,
          pointsPerCorrect: c.pointsPerCorrect,
          isKeyTiebreaker: c.isKeyTiebreaker,
          settlesAfterStage: c.settlesAfterStage,
          itemType: c.itemType,
          sortOrder: c.sortOrder,
        })),
      )
      .onConflictDoUpdate({
        target: bonusCategories.id,
        set: { nameRu: sqlExcluded("name_ru"), pointsPerCorrect: sqlExcluded("points_per_correct") },
      });

    // Resolve team code -> id for the group fixtures.
    const teamRows = await tx.select({ id: teams.id, code: teams.code }).from(teams);
    const teamIdByCode = new Map(teamRows.map((r) => [r.code, r.id]));

    // 5a. group matches (1–72)
    const groupSchedule = buildGroupSchedule();
    await tx
      .insert(matches)
      .values(
        groupSchedule.map((m) => ({
          tournamentId: TOURNAMENT_ID,
          fifaMatchNo: m.fifaMatchNo,
          stage: "GROUP",
          groupCode: m.groupCode,
          homeTeamId: teamIdByCode.get(m.homeCode)!,
          awayTeamId: teamIdByCode.get(m.awayCode)!,
          kickoffAt: m.kickoffAt,
          deadlineAt: new Date(m.kickoffAt.getTime() - MATCH_LEAD_MS),
          venue: m.venue,
          city: m.city,
          status: "SCHEDULED",
          x2Allowed: false,
        })),
      )
      .onConflictDoUpdate({
        target: [matches.tournamentId, matches.fifaMatchNo],
        set: {
          homeTeamId: sqlExcluded("home_team_id"),
          awayTeamId: sqlExcluded("away_team_id"),
          kickoffAt: sqlExcluded("kickoff_at"),
          deadlineAt: sqlExcluded("deadline_at"),
          venue: sqlExcluded("venue"),
          city: sqlExcluded("city"),
        },
      });

    // 5b. knockout matches (73–104) — slot placeholders, kickoff/deadline NULL.
    await tx
      .insert(matches)
      .values(
        KNOCKOUT_MATCHES.map((k) => ({
          tournamentId: TOURNAMENT_ID,
          fifaMatchNo: k.fifaMatchNo,
          stage: k.stage,
          homeSlot: k.homeSlot,
          awaySlot: k.awaySlot,
          status: "SCHEDULED",
          x2Allowed: PLAYOFF_STAGES.includes(k.stage),
        })),
      )
      .onConflictDoUpdate({
        target: [matches.tournamentId, matches.fifaMatchNo],
        set: { homeSlot: sqlExcluded("home_slot"), awaySlot: sqlExcluded("away_slot") },
      });

    // 6. participants (roster)
    await tx
      .insert(participants)
      .values(ROSTER.map((displayName, i) => ({ rosterNo: i + 1, displayName })))
      .onConflictDoUpdate({
        target: participants.rosterNo,
        set: { displayName: sqlExcluded("display_name") },
      });
  });

  const counts = await db.execute(
    sql.raw(`SELECT
      (SELECT count(*) FROM teams) AS teams,
      (SELECT count(*) FROM matches) AS matches,
      (SELECT count(*) FROM matches WHERE stage='GROUP') AS group_matches,
      (SELECT count(*) FROM bonus_categories) AS bonus_categories,
      (SELECT count(*) FROM participants) AS participants`),
  );
  console.log("Seed complete:", counts[0]);
  process.exit(0);
}

// Drizzle helper: reference the conflicting row's EXCLUDED value in onConflictDoUpdate.
function sqlExcluded(column: string) {
  return sql.raw(`excluded.${column}`);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
