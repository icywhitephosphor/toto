// GET /api/matches/:id — single match detail + the caller's own bet (06 §3.7).
import { and, eq } from "drizzle-orm";
import { route, ok, AppError } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { getAuth } from "@/lib/auth";
import { getMatchById } from "@/lib/api/match-queries";
import { db } from "@/db";
import { matchBets } from "@/db/schema";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (req, ctxArg) => {
  enforceRateLimit(req, "general");
  const { id } = await ctxArg.params;

  const match = await getMatchById(id);
  if (!match) throw new AppError(404, "MATCH_NOT_FOUND", "Match not found");

  let myBet = null;
  const auth = await getAuth(req);
  if (auth?.participant) {
    const [bet] = await db
      .select()
      .from(matchBets)
      .where(and(eq(matchBets.participantId, auth.participant.id), eq(matchBets.matchId, id)))
      .limit(1);
    if (bet) {
      myBet = {
        pred_home: bet.predHome,
        pred_away: bet.predAway,
        x2: bet.x2,
        pen_winner: bet.penWinner,
        submitted_at: bet.submittedAt.toISOString(),
        updated_at: bet.updatedAt.toISOString(),
        version: bet.version,
      };
    }
  }

  return ok({ match, my_bet: myBet });
});
