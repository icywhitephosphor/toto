// GET /api/bootstrap — single-round-trip boot payload (06 §3.4). Public: returns
// user/participant null when unauthenticated. Refreshes the session token if it
// is near expiry (07 §6.3).
import { route, ok } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { getAuth } from "@/lib/auth";
import { userShape, participantShape } from "@/lib/api/auth-flow";
import { getTournament, serializeTournament, deadlinesSummary } from "@/lib/api/tournament";
import { signSession, setSessionCookie } from "@/lib/session";

export const GET = route(async (req) => {
  enforceRateLimit(req, "general");

  const ctx = await getAuth(req);
  const t = await getTournament();
  const deadlines = await deadlinesSummary(t);

  const res = ok({
    user: ctx ? userShape(ctx.user) : null,
    participant: ctx ? participantShape(ctx.participant) : null,
    tournament: serializeTournament(t),
    deadlines,
  });

  if (ctx?.needsRefresh) {
    const token = await signSession({
      sub: ctx.user.id,
      tg: ctx.user.telegramId,
      pid: ctx.participant?.id,
      adm: ctx.user.isAdmin ? true : undefined,
    });
    setSessionCookie(res, token);
  }

  return res;
});
