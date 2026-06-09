// POST /api/admin/participants/:id/rebind — detach a participant from its
// Telegram user and bind it to another (or free the slot) (06 §3.20, 07 §5.3).
import { eq, and, ne } from "drizzle-orm";
import { route, ok, AppError, clientMeta } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/db";
import { participants, users } from "@/db/schema";
import { writeAudit } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route<Ctx>(async (req, ctxArg) => {
  const ctx = await requireAdmin(req);
  enforceRateLimit(req, "admin", ctx.user.id);
  const { id } = await ctxArg.params;
  const meta = clientMeta(req);

  let body: { new_user_id?: unknown; reason?: unknown };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const newUserId = body.new_user_id == null ? null : String(body.new_user_id);

  const [participant] = await db.select().from(participants).where(eq(participants.id, id)).limit(1);
  if (!participant) throw new AppError(404, "PARTICIPANT_NOT_FOUND", "Participant not found");

  if (newUserId) {
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, newUserId)).limit(1);
    if (!user) throw new AppError(404, "USER_NOT_FOUND", "Target user not found");

    const [otherClaim] = await db
      .select({ id: participants.id })
      .from(participants)
      .where(and(eq(participants.userId, newUserId), ne(participants.id, id)))
      .limit(1);
    if (otherClaim) throw new AppError(409, "USER_ALREADY_BOUND", "User already bound to another participant");
  }

  const oldUserId = participant.userId;

  await db.transaction(async (tx) => {
    await tx.update(participants).set({ userId: null }).where(eq(participants.id, id));
    if (newUserId) {
      await tx.update(participants).set({ userId: newUserId }).where(eq(participants.id, id));
    }
    await writeAudit(tx, {
      actorUserId: ctx.user.id,
      actorKind: "ADMIN",
      action: "PARTICIPANT_REBIND",
      entityType: "participant",
      entityId: id,
      before: { user_id: oldUserId },
      after: { user_id: newUserId },
      reason: typeof body.reason === "string" ? body.reason : null,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  });

  return ok({ participant_id: id, old_user_id: oldUserId, new_user_id: newUserId });
});
