# Claude Code — kickoff prompt (Phase 1 MVP)

Paste the block below as your first message to Claude Code, with the session opened in this repo
(the one containing the `architecture/` folder).

---

GOAL: Build the **Phase 1 MVP** of the "TOTO WC-2026" web app. It's a FIFA World Cup 2026 betting pool
for ~21 friends: Telegram login, each person submits their **own** score predictions, automatic scoring
from a live football feed, a live leaderboard, and a Google Sheets export. The complete design already
exists in the `architecture/` folder of this repo — **that folder is the source of truth. Read it before
writing any code.**

START HERE (do this first, then stop and show me a plan):
1. Read `architecture/00-README.md` (canonical decisions), then `01` (requirements + the formalized
   rules), `02` (stack + ADR), `03` (teams/groups/bracket), `04` (DB schema), `05` (scoring engine),
   `06` (API spec), `13` (build order). Skim `07`–`12` as needed.
2. Propose a concrete Phase-1 implementation plan and repo structure. **Do not build everything at once.**
   Confirm the open-question defaults in `01 §7`, ask me anything ambiguous, and wait for my go-ahead
   before generating the bulk of the code.

STACK (Track A — already decided in `02`/`14`, don't re-litigate):
- **Next.js (App Router) + TypeScript**, one app. UI strings in **Russian**; all code/identifiers/comments
  in **English**.
- **PostgreSQL + Drizzle ORM** with migrations.
- **Telegram Mini App** auth (`initData`), Login Widget as fallback — implement **both** HMAC schemes
  exactly as in `07`. They are DIFFERENT: Mini App secret = `HMAC_SHA256(key="WebAppData", msg=bot_token)`;
  Login Widget secret = `SHA256(bot_token)` (raw bytes). Use `node:crypto` and `timingSafeEqual`.
- **node-cron worker** for polling/export. **football-data.org** free tier as the results feed (`08`);
  the admin **confirms all 32 play-off results** before they score.
- **Google Sheets** export via a service account (`09`).
- Deployment target: **Docker Compose** (`caddy` + `app` + `worker` + `db`) on a VPS at
  **toto.icywhitephosphor.tech / 72.56.232.82**, HTTPS via Caddy. Produce a `docker-compose.yml` +
  `Caddyfile` matching `02 §7` and `12`.

PHASE 1 SCOPE (definition of done):
- DB schema from `04` + seed data: 48 teams, 12 groups, 104 matches (knockout slots per `03 §4`),
  the 7 bonus categories, and the 21 participants (names in `04 §8`).
- Telegram login + one-time participant **claim** from the fixed 21-name roster (allow-list);
  JWT in an httpOnly+Secure+SameSite cookie.
- **Match-bet entry** (group stage + play-off ×2) with **server-side** deadline lock (kickoff − 3h) and
  the partial-save batch endpoint `PUT /api/me/match-bets` from `06` (idempotency key, `saved`/`rejected`).
- **Bonus-bet entry** for all 7 categories with the global lock at **2026-06-10 20:00:00Z** (= 23:00 MSK),
  validation (exact item counts, no duplicate teams).
- **Scoring engine** as a pure module exactly per `05`, with **unit tests covering all nine worked
  examples** in `05 §6` — they MUST pass. Expected points, in order: `1, 4, −4, 6, 8, 0, 14, 20, −10`,
  plus the canonical penalty case (ET 2:2, pens 5:3 → toto 3:2). Write these tests FIRST (TDD) and run them.
- **Leaderboard** from the `v_standings` view with the 4-level tie-break in `05 §5`, served from a
  `leaderboard_snapshots` row; the client polls `/api/leaderboard` (SWR ~20–30s).
- **Manual admin result entry** + recompute (`PATCH /api/admin/matches/:id/result`,
  `POST /api/admin/recalculate`) so the app fully works **before** the live feed is wired.
- One **Google Sheets export** — start with a single private sheet; the public/redacted split is Phase 2.

NON-NEGOTIABLE (fairness & correctness):
- Deadlines enforced on the **server** (return HTTP **423** when locked); never trust the client clock.
- A participant can **never** see another's bet before that bet's deadline — authorize the reveal endpoints.
- Bets are **immutable after their deadline**; every bet write and result change is written to `audit_log`.
- Scoring is deterministic and reproducible; the engine is the **only** place points are computed; tests gate it.
- Match the table / column / endpoint names in `04` and `06` **exactly**.

OUT OF SCOPE for Phase 1 (these are Track B / later phases — do NOT add them now): Redis, BullMQ/queues,
SSE/WebSockets, multi-provider adapters, materialized views, a full admin panel. `14` explains why.

SECRETS (server-only `.env`, never shipped to the client): `BOT_TOKEN`, `BOT_USERNAME`, `DATABASE_URL`,
`FD_TOKEN`, `GOOGLE_SA_JSON`, `SHEET_ID`, `JWT_SECRET`.

WORKING STYLE: small, reviewable commits; run the scoring tests on every change; a working
`docker compose up` with migrations + seed; a `/api/health` endpoint. When Phase 1 is done and green,
we'll start Phase 2 (provider polling, progressive bonus settlement, reveal endpoints, the ×2
AWAITING_CONFIRM flow) from `13`.

---
