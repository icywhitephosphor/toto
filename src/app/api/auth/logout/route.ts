// POST /api/auth/logout — clear the session cookie (idempotent; JWT is stateless).
import { route, ok } from "@/lib/http";
import { clearSessionCookie } from "@/lib/session";

export const POST = route(async () => {
  const res = ok({ ok: true });
  clearSessionCookie(res);
  return res;
});
