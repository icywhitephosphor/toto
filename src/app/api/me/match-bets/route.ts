// GET  /api/me/match-bets — the caller's own match bets (12 §3.2).
// PUT  /api/me/match-bets — batch upsert with PARTIAL-SAVE semantics (06 §3.8,
//   11 §5): each bet is validated independently; locked/invalid bets go to
//   `rejected`, the rest are saved. Server clock enforces deadlines (HTTP 200
//   overall; per-bet failures in `rejected`). Idempotent via idempotency_key.
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { route, ok, AppError, parseJson, clientMeta } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { requireParticipant } from "@/lib/auth";
import { db } from "@/db";
import { matches, matchBets, idempotencyKeys, scoreEvents } from "@/db/schema";
import { writeAudit } from "@/lib/audit";

export const GET = route(async (req) => {
  const ctx = await requireParticipant(req);
  enforceRateLimit(req, "me", ctx.user.id);

  const rows = await db
    .select({
      bet: matchBets,
      points: scoreEvents.points, // null until the match result is usable
    })
    .from(matchBets)
    .leftJoin(
      scoreEvents,
      and(eq(scoreEvents.participantId, matchBets.participantId), eq(scoreEvents.matchId, matchBets.matchId)),
    )
    .where(eq(matchBets.participantId, ctx.participant.id));

  return ok({
    bets: rows.map(({ bet: b, points }) => ({
      match_id: b.matchId,
      pred_home: b.predHome,
      pred_away: b.predAway,
      x2: b.x2,
      pen_winner: b.penWinner,
      version: b.version,
      points,
      updated_at: b.updatedAt.toISOString(),
    })),
  });
});

const betSchema = z.object({
  match_id: z.string().min(1),
  pred_home: z.number().int(),
  pred_away: z.number().int(),
  x2: z.boolean().optional().default(false),
  pen_winner: z.enum(["HOME", "AWAY"]).nullable().optional(),
  version: z.number().int().optional(),
});
const bodySchema = z.object({
  idempotency_key: z.string().min(1).optional(),
  bets: z.array(betSchema).min(1),
});

type SavedItem = { match_id: string; status: "SAVED"; version: number };
type RejectedItem = {
  match_id: string;
  status: string;
  deadline_at?: string | null;
  reason?: string;
};

export const PUT = route(async (req) => {
  const ctx = await requireParticipant(req);
  enforceRateLimit(req, "me", ctx.user.id);
  const meta = clientMeta(req);
  const participantId = ctx.participant.id;

  const body = await parseJson(req, bodySchema);

  // --- Idempotency: replay the stored response if this key was seen within 24h
  // (06 §4). Keys are scoped to this participant, so no cross-user replay. ---
  if (body.idempotency_key) {
    const cutoff = new Date(Date.now() - 24 * 3600_000);
    const [prev] = await db
      .select({ response: idempotencyKeys.response })
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.participantId, participantId),
          eq(idempotencyKeys.idempotencyKey, body.idempotency_key),
          gt(idempotencyKeys.createdAt, cutoff),
        ),
      )
      .limit(1);
    if (prev) return ok(prev.response as Record<string, unknown>);
  }

  // Load every referenced match once.
  const matchIds = [...new Set(body.bets.map((b) => b.match_id))];
  const matchRows = await db
    .select({
      id: matches.id,
      stage: matches.stage,
      status: matches.status,
      deadlineAt: matches.deadlineAt,
      x2Allowed: matches.x2Allowed,
    })
    .from(matches)
    .where(inArray(matches.id, matchIds));
  const matchById = new Map(matchRows.map((m) => [m.id, m]));

  // Existing bets (for version checks + audit `before`).
  const existing = await db
    .select()
    .from(matchBets)
    .where(and(eq(matchBets.participantId, participantId), inArray(matchBets.matchId, matchIds)));
  const existingByMatch = new Map(existing.map((b) => [b.matchId, b]));

  const now = new Date();
  const saved: SavedItem[] = [];
  const rejected: RejectedItem[] = [];

  type Upsert = { matchId: string; predHome: number; predAway: number; x2: boolean; penWinner: "HOME" | "AWAY" | null };
  const toUpsert: Upsert[] = [];

  for (const bet of body.bets) {
    const m = matchById.get(bet.match_id);
    if (!m) {
      rejected.push({ match_id: bet.match_id, status: "MATCH_NOT_FOUND" });
      continue;
    }
    if (m.deadlineAt === null) {
      rejected.push({ match_id: bet.match_id, status: "MATCH_NOT_OPEN", reason: "Kickoff not yet scheduled" });
      continue;
    }
    if (m.status === "CANCELLED") {
      rejected.push({ match_id: bet.match_id, status: "MATCH_NOT_OPEN", reason: "Match cancelled" });
      continue;
    }
    if (now >= m.deadlineAt) {
      rejected.push({
        match_id: bet.match_id,
        status: "LOCKED",
        deadline_at: m.deadlineAt.toISOString(),
        reason: "Match deadline has passed",
      });
      continue;
    }
    if (
      !Number.isInteger(bet.pred_home) ||
      !Number.isInteger(bet.pred_away) ||
      bet.pred_home < 0 ||
      bet.pred_home > 99 ||
      bet.pred_away < 0 ||
      bet.pred_away > 99
    ) {
      rejected.push({ match_id: bet.match_id, status: "INVALID_SCORE", reason: "Goals must be 0..99" });
      continue;
    }
    if (bet.x2 && !m.x2Allowed) {
      rejected.push({ match_id: bet.match_id, status: "X2_NOT_ALLOWED", reason: "×2 only in play-off stages" });
      continue;
    }

    const isDraw = bet.pred_home === bet.pred_away;

    // A play-off result is always the decisive toto score (regulation/ET +
    // shootout, with the shootout folded into "+1 goal for the winner"), so it
    // can never be a draw. The prediction is entered the same way — a decisive
    // score — and a drawn play-off prediction is rejected. No separate penalty
    // input: the winning side is simply whoever gets more goals (organizer rule).
    if (isDraw && m.x2Allowed) {
      rejected.push({
        match_id: bet.match_id,
        status: "PLAYOFF_DRAW_NOT_ALLOWED",
        reason: "В плей-офф нужен победитель: укажите решающий счёт",
      });
      continue;
    }

    const storedHome = bet.pred_home;
    const storedAway = bet.pred_away;

    // Optimistic concurrency (opt-in).
    if (bet.version !== undefined) {
      const cur = existingByMatch.get(bet.match_id);
      const curVersion = cur?.version ?? 0;
      if (bet.version !== curVersion) {
        rejected.push({ match_id: bet.match_id, status: "VERSION_CONFLICT", reason: `Current version is ${curVersion}` });
        continue;
      }
    }

    toUpsert.push({ matchId: bet.match_id, predHome: storedHome, predAway: storedAway, x2: bet.x2, penWinner: null });
  }

  if (toUpsert.length > 0) {
    await db.transaction(async (tx) => {
      for (const u of toUpsert) {
        const before = existingByMatch.get(u.matchId) ?? null;
        const [row] = await tx
          .insert(matchBets)
          .values({
            participantId,
            matchId: u.matchId,
            predHome: u.predHome,
            predAway: u.predAway,
            x2: u.x2,
            penWinner: u.penWinner,
            version: 1,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [matchBets.participantId, matchBets.matchId],
            set: {
              predHome: u.predHome,
              predAway: u.predAway,
              x2: u.x2,
              penWinner: u.penWinner,
              updatedAt: now,
              version: sql`${matchBets.version} + 1`,
            },
          })
          .returning({ id: matchBets.id, version: matchBets.version });

        await writeAudit(tx, {
          actorUserId: ctx.user.id,
          actorKind: "USER",
          action: "BET_UPSERT",
          entityType: "match_bet",
          entityId: row.id,
          before: before
            ? { pred_home: before.predHome, pred_away: before.predAway, x2: before.x2, pen_winner: before.penWinner }
            : null,
          after: { pred_home: u.predHome, pred_away: u.predAway, x2: u.x2, pen_winner: u.penWinner },
          ip: meta.ip,
          userAgent: meta.userAgent,
        });

        saved.push({ match_id: u.matchId, status: "SAVED", version: row.version });
      }
    });
  }

  const response = { saved, rejected };

  if (body.idempotency_key) {
    await db
      .insert(idempotencyKeys)
      .values({ participantId, idempotencyKey: body.idempotency_key, response })
      .onConflictDoNothing();
  }

  return ok(response);
});
