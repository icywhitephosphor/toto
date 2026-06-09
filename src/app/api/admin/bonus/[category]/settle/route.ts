// PATCH /api/admin/bonus/:category/settle — record the actual outcome for a bonus
// category, then recompute (06 §3.21, 05 §4). TEAM categories take an array of
// team_ids (length must match item_count); TOP_SCORER takes a player name.
import { eq, inArray } from "drizzle-orm";
import { route, ok, AppError, clientMeta } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/db";
import { bonusCategories, bonusOutcomes, teams } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { recomputeAll } from "@/lib/recompute";
import { TOURNAMENT_ID } from "@/lib/env";

type Ctx = { params: Promise<{ category: string }> };

export const PATCH = route<Ctx>(async (req, ctxArg) => {
  const ctx = await requireAdmin(req);
  enforceRateLimit(req, "admin", ctx.user.id);
  const { category } = await ctxArg.params;
  const meta = clientMeta(req);

  const [cat] = await db.select().from(bonusCategories).where(eq(bonusCategories.id, category)).limit(1);
  if (!cat) throw new AppError(404, "CATEGORY_NOT_FOUND", "Unknown bonus category");

  let body: { actual?: unknown };
  try {
    body = await req.json();
  } catch {
    throw new AppError(400, "BAD_REQUEST", "Malformed JSON body");
  }

  const outcomeValues: Array<{ categoryId: string; teamId?: string; playerName?: string }> = [];

  if (cat.itemType === "TEAM") {
    const actual = body.actual;
    if (!Array.isArray(actual) || actual.some((x) => typeof x !== "string")) {
      throw new AppError(422, "WRONG_ITEM_COUNT", "actual must be an array of team ids");
    }
    if (actual.length !== cat.itemCount) {
      throw new AppError(422, "WRONG_ITEM_COUNT", `expected ${cat.itemCount} team ids`, {
        expected: cat.itemCount,
        got: actual.length,
      });
    }
    const valid = new Set(
      (await db.select({ id: teams.id }).from(teams).where(inArray(teams.id, actual as string[]))).map((r) => r.id),
    );
    for (const id of actual as string[]) {
      if (!valid.has(id)) throw new AppError(422, "TEAM_NOT_IN_TOURNAMENT", `team_id ${id} not in wc2026`);
      outcomeValues.push({ categoryId: category, teamId: id });
    }
  } else {
    const actual = body.actual;
    if (typeof actual !== "string" || actual.trim().length === 0) {
      throw new AppError(422, "EMPTY_PLAYER_NAME", "actual must be a non-empty player name");
    }
    outcomeValues.push({ categoryId: category, playerName: actual.trim() });
  }

  const [before] = [
    await db.select().from(bonusOutcomes).where(eq(bonusOutcomes.categoryId, category)),
  ];

  await db.transaction(async (tx) => {
    await tx.delete(bonusOutcomes).where(eq(bonusOutcomes.categoryId, category));
    await tx.insert(bonusOutcomes).values(outcomeValues);
    await writeAudit(tx, {
      actorUserId: ctx.user.id,
      actorKind: "ADMIN",
      action: "BONUS_SETTLE",
      entityType: "bonus_outcome",
      entityId: category,
      before,
      after: outcomeValues,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  });

  const result = await recomputeAll(`bonus ${category} settled`, ctx.user.id);

  return ok({
    category_id: category,
    outcomes_written: outcomeValues.length,
    recompute_triggered: true,
    snapshot_id: result.snapshotId,
  });
});
