// POST /api/auth/telegram/miniapp — verify Telegram Mini App initData (07 §3.2),
// upsert the user, issue the session cookie.
import { route, ok, AppError, clientMeta } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { verifyMiniAppInitData } from "@/lib/telegram-auth";
import { loginWithIdentity, userShape, participantShape } from "@/lib/api/auth-flow";
import { setSessionCookie } from "@/lib/session";

export const POST = route(async (req) => {
  enforceRateLimit(req, "auth");

  let body: { init_data?: unknown };
  try {
    body = await req.json();
  } catch {
    throw new AppError(400, "MISSING_INIT_DATA", "init_data is required");
  }
  const initData = body.init_data;
  if (typeof initData !== "string" || initData.length === 0) {
    throw new AppError(400, "MISSING_INIT_DATA", "init_data is required");
  }

  const identity = verifyMiniAppInitData(initData);
  const { user, participant, token } = await loginWithIdentity(identity, clientMeta(req));

  const res = ok({ user: userShape(user), participant: participantShape(participant) });
  setSessionCookie(res, token);
  return res;
});
