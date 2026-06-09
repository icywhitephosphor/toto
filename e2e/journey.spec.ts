import { test, expect } from "@playwright/test";
import { resetDb, devLogin, claimFirstFree, firstGroupMatchId, adminLogin } from "./helpers";

test.beforeEach(async () => {
  await resetDb();
});

test("login → claim → place a match bet (full UI journey)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /ЧМ-2026/ })).toBeVisible();

  // Dev login via the on-screen form.
  await page.getByPlaceholder("Имя").fill("Тест Игрок");
  await page.getByPlaceholder("Telegram ID").fill("500001");
  await page.getByRole("button", { name: "Войти (dev)" }).click();

  // Claim screen.
  await expect(page.getByRole("heading", { name: "Кто вы?" })).toBeVisible();
  await page.getByRole("button", { name: /Гнатенко Артём/ }).click();

  // Hub.
  await expect(page.getByRole("heading", { name: /ПРИВЕТ/i })).toBeVisible();

  // Matches → place a bet on the first group match.
  await page.goto("/matches");
  const firstCard = page.locator(".card").first();
  await expect(firstCard).toBeVisible();
  await firstCard.getByRole("button", { name: "+", exact: true }).first().click(); // home +1
  await firstCard.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Прогноз сохранён")).toBeVisible();
});

test("score can be typed directly into the field (mobile keypad path)", async ({ page }) => {
  await page.goto("/");
  await devLogin(page, 500006, "Тайпер");
  await claimFirstFree(page);
  await page.goto("/matches");

  const firstCard = page.locator(".card").first();
  const inputs = firstCard.locator(".score-input");
  await inputs.first().fill("3");
  await inputs.nth(1).fill("1");
  await firstCard.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Прогноз сохранён")).toBeVisible();
});

test("server hides others' bets before the deadline (fairness)", async ({ page }) => {
  await page.goto("/");
  await devLogin(page, 500002, "Ревью Тест");
  await claimFirstFree(page);
  const matchId = await firstGroupMatchId(page.request);

  await page.goto(`/match/${matchId}`);
  await expect(page.getByText(/скрыт/i)).toBeVisible(); // "Прогнозы скрыты до дедлайна"
});

test("admin enters a result → leaderboard reflects points", async ({ page, request }) => {
  // A participant bets 1:2 on match 1 (correct AWAY outcome for a 0:3 result → 1 pt, GROUP).
  await page.goto("/");
  await devLogin(page, 500003, "Бомбардир");
  const myName = await claimFirstFree(page);
  const matchId = await firstGroupMatchId(page.request);
  const put = await page.request.put("/api/me/match-bets", {
    data: { idempotency_key: "e2e-1", bets: [{ match_id: matchId, pred_home: 1, pred_away: 2, x2: false }] },
  });
  expect(put.ok()).toBeTruthy();

  // Admin sets the result 0:3 (auto-recompute).
  await adminLogin(request);
  const res = await request.patch(`/api/admin/matches/${matchId}/result`, {
    data: { base_home: 0, base_away: 3, result_status: "FT" },
  });
  expect(res.ok()).toBeTruthy();
  expect((await res.json()).recompute_triggered).toBe(true);

  // Leaderboard shows the better's row at 1 point.
  await page.goto("/leaderboard");
  const row = page.locator(".lb-row", { hasText: myName });
  await expect(row).toBeVisible();
  await expect(row.locator(".lb-pts")).toHaveText("1");
});

test("bonus rejects a wrong item count (validation)", async ({ page }) => {
  await page.goto("/");
  await devLogin(page, 500004, "Бонус Тест");
  await claimFirstFree(page);

  // GROUP_WINNER needs 12 teams; sending 1 must fail with 422 WRONG_ITEM_COUNT.
  const teams = await (await page.request.get("/api/matches?stage=GROUP")).json();
  const oneTeamId = teams.matches[0].home_team.id;
  const res = await page.request.put("/api/me/bonus-bets", {
    data: { categories: [{ category_id: "GROUP_WINNER", items: [{ team_id: oneTeamId }] }] },
  });
  expect(res.status()).toBe(422);
  expect((await res.json()).error.code).toBe("WRONG_ITEM_COUNT");
});

test("x2 is rejected on a group-stage bet", async ({ page }) => {
  await page.goto("/");
  await devLogin(page, 500005, "Икс Два");
  await claimFirstFree(page);
  const matchId = await firstGroupMatchId(page.request);

  const res = await page.request.put("/api/me/match-bets", {
    data: { idempotency_key: "e2e-x2", bets: [{ match_id: matchId, pred_home: 2, pred_away: 1, x2: true }] },
  });
  const body = await res.json();
  expect(body.rejected[0].status).toBe("X2_NOT_ALLOWED");
});
