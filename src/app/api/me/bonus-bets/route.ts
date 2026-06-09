// GET /api/me/bonus-bets — the caller's bonus picks across all 7 categories (06 §3.9).
// PUT /api/me/bonus-bets — write categories atomically with exact-count / no-duplicate
//   / item-type validation and the global bonus lock at 2026-06-10 20:00Z (06 §3.10,
//   FR-5/6, 11 §3.1). All-or-nothing: the first invalid category fails the request.
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { route, ok, AppError, parseJson, clientMeta } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { requireParticipant } from "@/lib/auth";
import { db } from "@/db";
import { bonusCategories, bonusBets, bonusBetItems, teams } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { getTournament, isBonusLocked } from "@/lib/api/tournament";
import { TOURNAMENT_ID } from "@/lib/env";

export const GET = route(async (req) => {
  const ctx = await requireParticipant(req);
  enforceRateLimit(req, "me", ctx.user.id);
  const t = await getTournament();

  const betRows = await db
    .select({ id: bonusBets.id, categoryId: bonusBets.categoryId, submittedAt: bonusBets.submittedAt, updatedAt: bonusBets.updatedAt })
    .from(bonusBets)
    .where(eq(bonusBets.participantId, ctx.participant.id));

  const betIds = betRows.map((b) => b.id);
  const items = betIds.length
    ? await db
        .select({
          bonusBetId: bonusBetItems.bonusBetId,
          teamId: bonusBetItems.teamId,
          playerName: bonusBetItems.playerName,
          position: bonusBetItems.position,
          code: teams.code,
          nameRu: teams.nameRu,
        })
        .from(bonusBetItems)
        .leftJoin(teams, eq(teams.id, bonusBetItems.teamId))
        .where(inArray(bonusBetItems.bonusBetId, betIds))
    : [];

  const itemsByBet = new Map<string, typeof items>();
  for (const it of items) {
    if (!itemsByBet.has(it.bonusBetId)) itemsByBet.set(it.bonusBetId, []);
    itemsByBet.get(it.bonusBetId)!.push(it);
  }

  return ok({
    bonus_deadline_at: t.bonusDeadlineAt.toISOString(),
    locked: isBonusLocked(t),
    bets: betRows.map((b) => ({
      category_id: b.categoryId,
      items: (itemsByBet.get(b.id) ?? [])
        .sort((a, c) => a.position - c.position)
        .map((it) =>
          it.teamId
            ? { team_id: it.teamId, code: it.code, name_ru: it.nameRu }
            : { player_name: it.playerName },
        ),
      submitted_at: b.submittedAt.toISOString(),
      updated_at: b.updatedAt.toISOString(),
    })),
  });
});

const bodySchema = z.object({
  categories: z
    .array(
      z.object({
        category_id: z.string().min(1),
        items: z
          .array(z.object({ team_id: z.string().optional(), player_name: z.string().optional() }))
          .min(1),
      }),
    )
    .min(1),
});

export const PUT = route(async (req) => {
  const ctx = await requireParticipant(req);
  enforceRateLimit(req, "me", ctx.user.id);
  const meta = clientMeta(req);
  const participantId = ctx.participant.id;

  const t = await getTournament();
  if (isBonusLocked(t)) {
    throw new AppError(423, "BONUS_DEADLINE_PASSED", "Bonus deadline has passed", {
      deadline_at: t.bonusDeadlineAt.toISOString(),
    });
  }

  let body;
  try {
    body = await parseJson(req, bodySchema);
  } catch (err) {
    throw new AppError(400, "MISSING_CATEGORIES", "categories is required and must be non-empty");
  }

  // Reference data.
  const cats = await db.select().from(bonusCategories).where(eq(bonusCategories.tournamentId, TOURNAMENT_ID));
  const catById = new Map(cats.map((c) => [c.id, c]));
  const validTeamIds = new Set(
    (await db.select({ id: teams.id }).from(teams).where(eq(teams.tournamentId, TOURNAMENT_ID))).map((r) => r.id),
  );

  // Validate every category up front (atomic — no partial writes).
  for (const c of body.categories) {
    const cat = catById.get(c.category_id);
    if (!cat) throw new AppError(404, "CATEGORY_NOT_FOUND", `Unknown category ${c.category_id}`);
    if (c.items.length !== cat.itemCount) {
      throw new AppError(422, "WRONG_ITEM_COUNT", `${c.category_id} expects ${cat.itemCount} items`, {
        category_id: c.category_id,
        expected: cat.itemCount,
        got: c.items.length,
      });
    }
    if (cat.itemType === "TEAM") {
      const seen = new Set<string>();
      for (const it of c.items) {
        if (!it.team_id || it.player_name) {
          throw new AppError(422, "WRONG_ITEM_TYPE", `${c.category_id} expects team_id items`);
        }
        if (!validTeamIds.has(it.team_id)) {
          throw new AppError(422, "TEAM_NOT_IN_TOURNAMENT", `team_id ${it.team_id} not in wc2026`);
        }
        if (seen.has(it.team_id)) {
          throw new AppError(422, "DUPLICATE_TEAM", `Duplicate team in ${c.category_id}`);
        }
        seen.add(it.team_id);
      }
    } else {
      const it = c.items[0];
      if (it.team_id || !it.player_name || it.player_name.trim().length === 0) {
        if (it.team_id) throw new AppError(422, "WRONG_ITEM_TYPE", `${c.category_id} expects a player_name`);
        throw new AppError(422, "EMPTY_PLAYER_NAME", `${c.category_id} player_name is blank`);
      }
    }
  }

  // Persist all categories in one transaction.
  await db.transaction(async (tx) => {
    for (const c of body.categories) {
      const cat = catById.get(c.category_id)!;
      const now = new Date();

      const [bet] = await tx
        .insert(bonusBets)
        .values({ participantId, categoryId: c.category_id, updatedAt: now })
        .onConflictDoUpdate({
          target: [bonusBets.participantId, bonusBets.categoryId],
          set: { updatedAt: now },
        })
        .returning({ id: bonusBets.id });

      // Replace items wholesale.
      await tx.delete(bonusBetItems).where(eq(bonusBetItems.bonusBetId, bet.id));
      await tx.insert(bonusBetItems).values(
        c.items.map((it, i) =>
          cat.itemType === "TEAM"
            ? { bonusBetId: bet.id, teamId: it.team_id!, position: i }
            : { bonusBetId: bet.id, playerName: it.player_name!.trim(), position: i },
        ),
      );

      await writeAudit(tx, {
        actorUserId: ctx.user.id,
        actorKind: "USER",
        action: "BONUS_BET_UPSERT",
        entityType: "bonus_bet",
        entityId: bet.id,
        after: { category_id: c.category_id, items: c.items },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    }
  });

  return ok({ saved_categories: body.categories.map((c) => c.category_id), locked: false });
});
