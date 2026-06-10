// Shared login: upsert the Telegram user, auto-grant admin if their id matches
// ADMIN_TELEGRAM_ID, issue the session JWT, and audit the login. Used by the
// Mini App, Login Widget, and dev-login routes.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, participants } from "@/db/schema";
import { env } from "@/lib/env";
import { signSession } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import type { ClientMeta } from "@/lib/http";
import type { VerifiedIdentity } from "@/lib/telegram-auth";
import type { UserRow, ParticipantRow } from "@/lib/auth";

export interface LoginResult {
  user: UserRow;
  participant: ParticipantRow | null;
  token: string;
}

export async function loginWithIdentity(
  identity: VerifiedIdentity,
  meta: ClientMeta,
): Promise<LoginResult> {
  const now = new Date();
  const shouldBeAdmin =
    (env.adminTelegramId != null && identity.id === env.adminTelegramId) ||
    (identity.username != null && env.adminUsernames.has(identity.username.toLowerCase()));

  const updateSet: Record<string, unknown> = {
    username: identity.username ?? null,
    firstName: identity.first_name ?? null,
    lastName: identity.last_name ?? null,
    photoUrl: identity.photo_url ?? null,
    lastLoginAt: now,
  };
  if (shouldBeAdmin) updateSet.isAdmin = true;

  const [user] = await db
    .insert(users)
    .values({
      telegramId: identity.id,
      username: identity.username ?? null,
      firstName: identity.first_name ?? null,
      lastName: identity.last_name ?? null,
      photoUrl: identity.photo_url ?? null,
      isAdmin: shouldBeAdmin,
      lastLoginAt: now,
    })
    .onConflictDoUpdate({ target: users.telegramId, set: updateSet })
    .returning();

  const [participant] = await db
    .select()
    .from(participants)
    .where(eq(participants.userId, user.id))
    .limit(1);

  const token = await signSession({
    sub: user.id,
    tg: user.telegramId,
    pid: participant?.id,
    adm: user.isAdmin ? true : undefined,
  });

  await writeAudit(db, {
    actorUserId: user.id,
    actorKind: "USER",
    action: "LOGIN",
    entityType: "user",
    entityId: user.id,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return { user, participant: participant ?? null, token };
}

export function userShape(user: UserRow) {
  return {
    id: user.id,
    telegram_id: user.telegramId,
    username: user.username,
    first_name: user.firstName,
    last_name: user.lastName,
    photo_url: user.photoUrl,
    is_admin: user.isAdmin,
  };
}

export function participantShape(p: ParticipantRow | null) {
  if (!p) return null;
  return { id: p.id, roster_no: p.rosterNo, display_name: p.displayName, status: p.status };
}
