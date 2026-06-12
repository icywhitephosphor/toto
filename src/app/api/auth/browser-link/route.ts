// POST /api/auth/browser-link — mint a one-time, 10-minute magic link that
// logs the CURRENT user into any browser (the opt-in web fallback; Telegram
// stays the primary login). Only the SHA-256 hash of the token is stored.
import { createHash, randomBytes } from "node:crypto";
import { route, ok, clientMeta } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { requireUser } from "@/lib/auth";
import { db } from "@/db";
import { loginTokens } from "@/db/schema";
import { writeAudit } from "@/lib/audit";

const TTL_SECONDS = 10 * 60;

/** Public origin: honour the proxy headers, fall back to the Host header. */
function publicOrigin(req: Parameters<Parameters<typeof route>[0]>[0]): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export const POST = route(async (req) => {
  const ctx = await requireUser(req);
  enforceRateLimit(req, "auth", ctx.user.id);
  const meta = clientMeta(req);

  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + TTL_SECONDS * 1000);

  await db.insert(loginTokens).values({ tokenHash, userId: ctx.user.id, expiresAt });

  await writeAudit(db, {
    actorUserId: ctx.user.id,
    actorKind: "USER",
    action: "BROWSER_LINK_CREATED",
    entityType: "user",
    entityId: ctx.user.id,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return ok({
    url: `${publicOrigin(req)}/api/auth/browser-login?token=${token}`,
    expires_in_seconds: TTL_SECONDS,
  });
});
