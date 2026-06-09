// Tournament metadata + deadline helpers shared by /api/bootstrap and the bet
// endpoints. Server clock is authoritative for all lock decisions (11 §3).
import { eq, gt, asc } from "drizzle-orm";
import { db } from "@/db";
import { tournaments, matches } from "@/db/schema";
import { TOURNAMENT_ID } from "@/lib/env";
import { AppError } from "@/lib/http";

export type TournamentRow = typeof tournaments.$inferSelect;

export async function getTournament(): Promise<TournamentRow> {
  const [t] = await db.select().from(tournaments).where(eq(tournaments.id, TOURNAMENT_ID)).limit(1);
  if (!t) throw new AppError(500, "INTERNAL_ERROR", "Tournament not seeded");
  return t;
}

export function isBonusLocked(t: TournamentRow, now = new Date()): boolean {
  return now.getTime() >= t.bonusDeadlineAt.getTime();
}

function formatLead(value: unknown): string {
  if (typeof value === "string") return value;
  // postgres interval may arrive as an object — coerce common shapes.
  if (value && typeof value === "object") {
    const v = value as { hours?: number; minutes?: number; seconds?: number };
    const hh = String(v.hours ?? 0).padStart(2, "0");
    const mm = String(v.minutes ?? 0).padStart(2, "0");
    const ss = String(v.seconds ?? 0).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }
  return "03:00:00";
}

export function serializeTournament(t: TournamentRow) {
  return {
    id: t.id,
    name: t.name,
    display_tz: t.displayTz,
    bonus_deadline_at: t.bonusDeadlineAt.toISOString(),
    match_deadline_lead: formatLead(t.matchDeadlineLead),
    starts_at: t.startsAt?.toISOString() ?? null,
    ends_at: t.endsAt?.toISOString() ?? null,
  };
}

export interface DeadlinesSummary {
  bonus_locked: boolean;
  bonus_deadline_at: string;
  next_match_deadline_at: string | null;
  next_match_id: string | null;
}

export async function deadlinesSummary(t: TournamentRow, now = new Date()): Promise<DeadlinesSummary> {
  const [next] = await db
    .select({ id: matches.id, deadlineAt: matches.deadlineAt })
    .from(matches)
    .where(gt(matches.deadlineAt, now))
    .orderBy(asc(matches.deadlineAt))
    .limit(1);

  return {
    bonus_locked: isBonusLocked(t, now),
    bonus_deadline_at: t.bonusDeadlineAt.toISOString(),
    next_match_deadline_at: next?.deadlineAt?.toISOString() ?? null,
    next_match_id: next?.id ?? null,
  };
}
