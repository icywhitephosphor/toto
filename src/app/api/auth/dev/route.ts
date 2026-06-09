// POST /api/auth/dev — password-less login for LOCAL DEV and Playwright E2E only.
// Hard-gated behind ALLOW_DEV_LOGIN=true AND NODE_ENV !== production. In prod
// this route returns 404 and never issues a session.
import { route, ok, AppError, clientMeta } from "@/lib/http";
import { loginWithIdentity, userShape, participantShape } from "@/lib/api/auth-flow";
import { setSessionCookie } from "@/lib/session";
import type { VerifiedIdentity } from "@/lib/telegram-auth";

function devLoginEnabled(): boolean {
  return process.env.ALLOW_DEV_LOGIN === "true" && process.env.NODE_ENV !== "production";
}

export const POST = route(async (req) => {
  if (!devLoginEnabled()) {
    throw new AppError(404, "NOT_FOUND", "Not found");
  }

  let body: { telegram_id?: unknown; first_name?: unknown; username?: unknown; last_name?: unknown };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const telegramId = Number(body.telegram_id);
  if (!Number.isFinite(telegramId) || telegramId <= 0) {
    throw new AppError(400, "BAD_REQUEST", "telegram_id (positive number) is required");
  }

  const identity: VerifiedIdentity = {
    id: telegramId,
    first_name: typeof body.first_name === "string" ? body.first_name : `Dev ${telegramId}`,
    last_name: typeof body.last_name === "string" ? body.last_name : undefined,
    username: typeof body.username === "string" ? body.username : undefined,
    auth_date: Math.floor(Date.now() / 1000),
  };

  const { user, participant, token } = await loginWithIdentity(identity, clientMeta(req));
  const res = ok({ user: userShape(user), participant: participantShape(participant) });
  setSessionCookie(res, token);
  return res;
});
