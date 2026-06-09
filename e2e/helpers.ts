import type { Page, APIRequestContext } from "@playwright/test";
import postgres from "postgres";
import { E2E_DATABASE_URL } from "./config";

/** Truncate user-generated data between tests; keep teams/matches/categories/roster. */
export async function resetDb(): Promise<void> {
  const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    await sql
      .unsafe(
        `TRUNCATE match_bets, bonus_bet_items, bonus_bets, bonus_outcomes,
         score_events, leaderboard_snapshots, idempotency_keys, audit_log, match_results
         RESTART IDENTITY CASCADE;
         UPDATE participants SET user_id = NULL;
         DELETE FROM users;`,
      )
      .simple();
  } finally {
    await sql.end();
  }
}

/** Dev-login on the page's browser context (cookie becomes available to the page). */
export async function devLogin(page: Page, telegramId: number, firstName: string): Promise<void> {
  const res = await page.request.post("/api/auth/dev", {
    data: { telegram_id: telegramId, first_name: firstName },
  });
  if (!res.ok()) throw new Error(`dev login failed: ${res.status()}`);
}

/** Claim the first unclaimed roster slot; returns its display name. */
export async function claimFirstFree(page: Page): Promise<string> {
  const list = await (await page.request.get("/api/participants")).json();
  const free = list.participants.find((p: { claimed: boolean }) => !p.claimed);
  await page.request.post("/api/participants/claim", { data: { participant_id: free.id } });
  return free.display_name as string;
}

export async function firstGroupMatchId(req: APIRequestContext): Promise<string> {
  const data = await (await req.get("/api/matches?stage=GROUP")).json();
  return data.matches[0].id as string;
}

/** Admin context that logs in as the configured admin (ADMIN_TELEGRAM_ID=100001). */
export async function adminLogin(req: APIRequestContext): Promise<void> {
  const res = await req.post("/api/auth/dev", { data: { telegram_id: 100001, first_name: "Админ" } });
  if (!res.ok()) throw new Error(`admin login failed: ${res.status()}`);
}
