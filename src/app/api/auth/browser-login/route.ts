// GET /api/auth/browser-login?token=… — consume a magic link minted by
// /api/auth/browser-link: atomically claim the single-use token, issue the
// normal 30-day session cookie and redirect to the app. Invalid/expired/used
// tokens redirect to the login screen with ?link=expired.
import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { clientMeta } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { db } from "@/db";
import { loginTokens, users, participants } from "@/db/schema";
import { signSession, setSessionCookie } from "@/lib/session";
import { writeAudit } from "@/lib/audit";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const origin = req.nextUrl.origin;
  const fail = () => NextResponse.redirect(new URL("/?link=expired", origin));
  try {
    enforceRateLimit(req, "auth");
    const token = req.nextUrl.searchParams.get("token");
    if (!token || token.length < 20) return fail();
    const tokenHash = createHash("sha256").update(token).digest("hex");

    // Atomic single-use claim: only one request can ever flip used_at.
    const claimed = await db
      .update(loginTokens)
      .set({ usedAt: sql`now()` })
      .where(
        and(
          eq(loginTokens.tokenHash, tokenHash),
          isNull(loginTokens.usedAt),
          gt(loginTokens.expiresAt, sql`now()`),
        ),
      )
      .returning({ userId: loginTokens.userId });
    if (claimed.length === 0) return fail();

    const [user] = await db.select().from(users).where(eq(users.id, claimed[0].userId)).limit(1);
    if (!user) return fail();
    const [participant] = await db
      .select({ id: participants.id })
      .from(participants)
      .where(eq(participants.userId, user.id))
      .limit(1);

    const session = await signSession({
      sub: user.id,
      tg: user.telegramId,
      pid: participant?.id,
      adm: user.isAdmin ? true : undefined,
    });

    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    const meta = clientMeta(req);
    await writeAudit(db, {
      actorUserId: user.id,
      actorKind: "USER",
      action: "LOGIN",
      entityType: "user",
      entityId: user.id,
      reason: "browser magic link",
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    const res = NextResponse.redirect(new URL("/", origin));
    setSessionCookie(res, session);
    return res;
  } catch {
    return fail();
  }
}
