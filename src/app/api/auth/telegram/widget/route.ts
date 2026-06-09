// POST /api/auth/telegram/widget — verify a Telegram Login Widget callback
// (07 §3.2, different SHA-256 secret derivation), upsert the user, issue session.
import { route, ok, AppError, clientMeta } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { verifyLoginWidget, type LoginWidgetPayload } from "@/lib/telegram-auth";
import { loginWithIdentity, userShape, participantShape } from "@/lib/api/auth-flow";
import { setSessionCookie } from "@/lib/session";

export const POST = route(async (req) => {
  enforceRateLimit(req, "auth");

  let body: Partial<LoginWidgetPayload>;
  try {
    body = await req.json();
  } catch {
    throw new AppError(400, "BAD_REQUEST", "Malformed JSON body");
  }
  if (body.id == null || body.auth_date == null || !body.hash) {
    throw new AppError(400, "BAD_REQUEST", "Missing Login Widget fields");
  }

  const identity = verifyLoginWidget(body as LoginWidgetPayload);
  const { user, participant, token } = await loginWithIdentity(identity, clientMeta(req));

  const res = ok({ user: userShape(user), participant: participantShape(participant) });
  setSessionCookie(res, token);
  return res;
});
