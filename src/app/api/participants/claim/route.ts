// POST /api/participants/claim — bind the authenticated user to an unclaimed
// roster slot (06 §3.5, 07 §5.2). Row lock + unique constraint prevent a race
// from double-claiming. Re-issues the JWT with the participant id.
import { eq, isNull, and } from "drizzle-orm";
import { route, ok, AppError, clientMeta } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { requireUser } from "@/lib/auth";
import { db } from "@/db";
import { participants } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { participantShape } from "@/lib/api/auth-flow";
import { signSession, setSessionCookie } from "@/lib/session";

export const POST = route(async (req) => {
  const ctx = await requireUser(req);
  enforceRateLimit(req, "me", ctx.user.id);

  if (ctx.participant) {
    throw new AppError(403, "ALREADY_CLAIMED_BY_YOU", "Caller already bound to a participant");
  }

  let body: { participant_id?: unknown };
  try {
    body = await req.json();
  } catch {
    throw new AppError(400, "MISSING_PARTICIPANT_ID", "participant_id is required");
  }
  const participantId = body.participant_id;
  if (typeof participantId !== "string" || participantId.length === 0) {
    throw new AppError(400, "MISSING_PARTICIPANT_ID", "participant_id is required");
  }

  const claimed = await db.transaction(async (tx) => {
    const [target] = await tx
      .select()
      .from(participants)
      .where(eq(participants.id, participantId))
      .for("update")
      .limit(1);

    if (!target) throw new AppError(404, "PARTICIPANT_NOT_FOUND", "participant_id not in roster");
    if (target.userId && target.userId !== ctx.user.id) {
      throw new AppError(409, "PARTICIPANT_TAKEN", "Participant already claimed by another user");
    }

    const [updated] = await tx
      .update(participants)
      .set({ userId: ctx.user.id })
      .where(and(eq(participants.id, participantId), isNull(participants.userId)))
      .returning();

    // If the row was claimed between SELECT FOR UPDATE and UPDATE (shouldn't
    // happen under the lock), updated is undefined → conflict.
    if (!updated) {
      if (target.userId === ctx.user.id) return target; // idempotent re-claim
      throw new AppError(409, "PARTICIPANT_TAKEN", "Participant already claimed by another user");
    }

    const meta = clientMeta(req);
    await writeAudit(tx, {
      actorUserId: ctx.user.id,
      actorKind: "USER",
      action: "PARTICIPANT_CLAIM",
      entityType: "participant",
      entityId: participantId,
      after: { user_id: ctx.user.id, display_name: updated.displayName },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return updated;
  });

  const token = await signSession({
    sub: ctx.user.id,
    tg: ctx.user.telegramId,
    pid: claimed.id,
    adm: ctx.user.isAdmin ? true : undefined,
  });

  const res = ok({ participant: participantShape(claimed) }, { status: 201 });
  setSessionCookie(res, token);
  return res;
});
