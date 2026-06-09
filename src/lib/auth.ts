// Auth guards for route handlers. The JWT only *transports* identity; on every
// request we re-read users + participants from the DB so a rebind or admin-flag
// change takes effect immediately (07 §6.1). pid/adm in the token are advisory.
import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, participants } from "@/db/schema";
import { AppError } from "./http";
import { SESSION_COOKIE, verifySession } from "./session";

export type UserRow = typeof users.$inferSelect;
export type ParticipantRow = typeof participants.$inferSelect;

export interface AuthContext {
  user: UserRow;
  participant: ParticipantRow | null;
  /** True if the token is near expiry and the response should refresh it. */
  needsRefresh: boolean;
}

/** Returns the auth context, or null if there is no valid session. */
export async function getAuth(req: NextRequest): Promise<AuthContext | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const verified = await verifySession(token);
  if (!verified) return null;

  const [user] = await db.select().from(users).where(eq(users.id, verified.payload.sub)).limit(1);
  if (!user) return null;

  const [participant] = await db
    .select()
    .from(participants)
    .where(eq(participants.userId, user.id))
    .limit(1);

  return { user, participant: participant ?? null, needsRefresh: verified.needsRefresh };
}

/** Require any authenticated user (401 otherwise). */
export async function requireUser(req: NextRequest): Promise<AuthContext> {
  const ctx = await getAuth(req);
  if (!ctx) throw new AppError(401, "UNAUTHENTICATED", "No valid session");
  return ctx;
}

/** Require an authenticated user who has claimed a participant (401/403). */
export async function requireParticipant(
  req: NextRequest,
): Promise<AuthContext & { participant: ParticipantRow }> {
  const ctx = await requireUser(req);
  if (!ctx.participant) {
    throw new AppError(403, "NO_PARTICIPANT", "Authenticated user has no claimed participant");
  }
  if (ctx.participant.status !== "ACTIVE") {
    throw new AppError(403, "NO_PARTICIPANT", "Participant is not active");
  }
  return ctx as AuthContext & { participant: ParticipantRow };
}

/** Require an admin (401/403). */
export async function requireAdmin(req: NextRequest): Promise<AuthContext> {
  const ctx = await requireUser(req);
  if (!ctx.user.isAdmin) {
    throw new AppError(403, "FORBIDDEN", "Admin role required");
  }
  return ctx;
}
