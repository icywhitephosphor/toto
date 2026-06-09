# TOTO WC-2026 — Architecture

A web application for a **friendly World Cup 2026 betting pool ("тотализатор")** among ~21 friends.
Each person authenticates with Telegram and submits their **own** predictions; the system scores
matches automatically from a live football data feed, shows a **live leaderboard**, and **exports**
everything to Google Sheets for transparency.

> Language policy: all design docs and code identifiers are in **English**. The **end-user UI is in
> Russian** (the audience is Russian-speaking friends). Russian rule terms are mapped to English
> codes in the glossary below.

---

## 0. TL;DR (the 60-second version)

* **Source of truth = PostgreSQL.** Google Sheets is an **export/mirror**, never the database.
* **Identity = Telegram.** We recommend a **Telegram Mini App** (in-app, seamless) over the legacy
  Login Widget; both are documented. Each Telegram account is bound to exactly one participant from
  the existing 21-person roster.
* **Deadlines are enforced server-side.** Bonus bets lock at **2026-06-10 23:00 MSK** (= 20:00 UTC).
  Match bets lock **3 hours before kickoff**. The client only *reflects* the lock; it never enforces it.
* **Bets are secret until their deadline.** Nobody can see anyone else's prediction for a match (or the
  bonus round) until that deadline passes. This is the core fairness requirement.
* **Scoring is a pure, deterministic, unit-tested module.** Every worked example from the rules sheet
  is encoded as a test (see `05-scoring-engine.md`).
* **Live results: free tier.** Primary feed is **football-data.org** (free, 10 req/min, exposes
  regular/extra-time/penalty breakdown → we can compute the canonical play-off score). The **32
  play-off results are always confirmed by the admin** before they count (high stakes + the ×2 rule).
* **Right-sized for 21 people.** The recommended architecture (Track A) is a single Next.js app + one
  Postgres database + scheduled polling. The heavyweight pieces in the GPT draft (Redis, BullMQ,
  SSE, multi-provider adapters, materialized views) are documented as **Track B growth options** you
  do **not** need on day one.

---

## 1. How to read this folder

| # | Doc | What it covers | Audience |
|---|-----|----------------|----------|
| 00 | `00-README.md` | This index + canonical decisions | Everyone |
| 01 | `01-context-and-requirements.md` | Actors, functional + non-functional requirements, the **formalized rules**, assumptions, open questions | Everyone |
| 02 | `02-architecture-overview.md` | C4 diagrams, recommended stack (ADR), Track A vs Track B, data-flow | Architect / dev |
| 03 | `03-domain-model-tournament.md` | WC-2026 specifics: teams, the 12 groups, the **match 73–104 bracket**, third-place "8 of 12" + 495-combination handling, RU↔stage mapping | Dev |
| 04 | `04-data-model.md` | Full PostgreSQL DDL, ER diagram, indexes, constraints, seed data | Dev (backend) |
| 05 | `05-scoring-engine.md` | Formal scoring spec, pure functions, canonical play-off score, **bonus settlement triggers**, tie-breakers, all worked examples as tests | Dev (backend) |
| 06 | `06-api-spec.md` | Every internal REST endpoint, request/response, errors, idempotency, partial-save | Dev (full-stack) |
| 07 | `07-telegram-auth.md` | Mini App vs Login Widget, **both HMAC schemes (correct)**, session, participant claim/rebind | Dev (auth) |
| 08 | `08-live-results-integration.md` | Provider comparison, exact calls + sample payloads, polling within free limits, provider→domain mapping, manual override policy | Dev (integration) |
| 09 | `09-google-sheets-export.md` | Service account, tab layout, exact Sheets API calls, private vs public sheet (secrecy) | Dev (integration) |
| 10 | `10-realtime-leaderboard.md` | Right-sized live updates (polling vs SSE), recompute strategy, snapshots | Dev |
| 11 | `11-deadlines-time-and-edge-cases.md` | Time-zone model, deadline computation, reschedules, the full edge-case catalogue | Dev |
| 12 | `12-security-fairness-ops-cost.md` | Threat model for a friends' pool, anti-cheat, RBAC, backups, hosting + **concrete monthly cost** | Architect / dev |
| 13 | `13-mvp-plan-and-build-order.md` | Realistic phased plan given the deadline; cut list; "if you only have 24h" path | Builder |
| 14 | `14-review-of-gpt-design.md` | Fair, detailed critique of the GPT draft: what's right, what's missing/wrong, corrections | You (ione) |

If you only read three: **01** (what we're building), **02** (how), **14** (how this differs from the
GPT draft and why).

---

## 2. Canonical decisions (the single source of truth for all docs)

Every other document conforms to the names and rules in this section. If something here conflicts with
another doc, **this section wins** (and the other doc is a bug).

### 2.1 Stage codes (RU rule term ↔ internal code ↔ FIFA name ↔ match numbers)

The pool's Russian stage names use the classic "1/16, 1/8" convention. WC-2026 added a Round of 32, so
the mapping must be explicit to avoid off-by-one-round errors:

| Russian rule term | Internal `stage` code | FIFA 2026 name | Match numbers | ×2 allowed |
|-------------------|-----------------------|----------------|--------------|:----------:|
| групповой этап | `GROUP` | Group stage | 1–72 | no |
| 1/16 финала | `R32` | Round of 32 | 73–88 | **yes** |
| 1/8 финала | `R16` | Round of 16 | 89–96 | **yes** |
| 1/4 финала | `QF` | Quarter-finals | 97–100 | **yes** |
| 1/2 финала | `SF` | Semi-finals | 101–102 | **yes** |
| матч за 3 место | `THIRD` | Third-place play-off | 103 | **yes** |
| финал | `FINAL` | Final | 104 | **yes** |

### 2.2 Match-bet points (exact score / correct outcome)

Points for exact score and for correct outcome **do not stack** — you get exact **or** outcome, never both.

| Stage | Exact-score pts | Outcome pts | ×2 |
|-------|:---------------:|:-----------:|:--:|
| `GROUP` | 2 | 1 | — |
| `R32` | 3 | 2 | yes |
| `R16` | 4 | 3 | yes |
| `QF` | 5 | 4 | yes |
| `SF` | 7 | 5 | yes |
| `THIRD` | 7 | 5 | yes |
| `FINAL` | 10 | 7 | yes |

**×2 rule (play-off only):** if the bettor opted in, a correct **exact score** pays `exact×2`; a correct
**outcome** (but wrong score) pays `outcome×2`; **missing both** score and outcome **subtracts the
(un-doubled) exact-score points**. No limit on how many ×2 bets a player makes.

### 2.3 Bonus (pre-tournament) bets

All bonus bets lock together at **2026-06-10 23:00 MSK**. Each category is an unordered **set** of teams
(except top scorer = a player name); points are awarded **per correct item**.

| Category id | Russian term | # picks | Pts / correct | Key tie-break? | Settles after |
|-------------|--------------|:-------:|:-------------:|:--------------:|---------------|
| `GROUP_WINNER` | победители групп | 12 | 3 | no | Group stage |
| `R16_PARTICIPANT` | участники 1/8 финала | 16 | 5 | no | R32 (matches 73–88) |
| `QF_PARTICIPANT` | участники 1/4 финала | 8 | 7 | **yes** | R16 (89–96) |
| `SF_PARTICIPANT` | участники полуфинала | 4 | 8 | **yes** | QF (97–100) |
| `FINALIST` | участники финала | 2 | 10 | **yes** | SF (101–102) |
| `CHAMPION` | победитель | 1 | 12 | **yes** | Final (104) |
| `TOP_SCORER` | лучший бомбардир | 1 | 7 | no | End of tournament |

> Note the stage-name subtlety: **`R16_PARTICIPANT` ("участники 1/8 финала") = the 16 teams that reach
> the Round of 16 = the 16 winners of the Round of 32**, so it is settled *after* the R32 matches finish.

### 2.4 Tie-breakers (descending priority)

1. `total_points` — total points, descending.
2. `playoff_match_points` — points from **match** bets in `R32…FINAL` (i.e., earned after the WC starts).
3. `key_bonus_points` — points from the **key** bonus categories: `QF_PARTICIPANT` + `SF_PARTICIPANT` +
   `FINALIST` + `CHAMPION`.
4. **"по росту :)"** — *by height* — the organizer's joke final tie-break. Modeled as a manual
   `tiebreak_rank` the organizer can set; absent that, a stable deterministic fallback (e.g. participant
   id) keeps the table from flickering. See `05-scoring-engine.md` §Tie-breakers.

### 2.5 Canonical play-off score

A bet is on the **final score**. For play-off matches the final ("toto") score = goals after regular +
extra time, then **the penalty-shootout winner gets +1 goal**. Example from the rules sheet: 2:2 after
extra time, 5:3 on penalties → **toto score 3:2**. Group-stage final score = the 90-minute score (draws
allowed). Play-off toto scores are therefore **always decisive** (never a draw). The UX consequence —
predicting a draw for a play-off is always a losing outcome — is handled in `05` and `06`.

### 2.6 Recommended stack (Track A)

| Layer | Choice | Why (short) |
|-------|--------|-------------|
| App | **Next.js (App Router) + TypeScript**, one container | One codebase for UI + API; trivial to host |
| DB | **PostgreSQL 16** (in Docker on the VPS, or Supabase/Neon free) | Transactions, unique constraints, the source of truth |
| ORM/migrations | **Drizzle** (or Prisma) | Typed schema + simple migrations |
| Auth | **Telegram Mini App `initData`** (Login Widget fallback) | Seamless in-Telegram, server-verifiable |
| Jobs | **`node-cron` worker** (always-on, on the VPS) | Poll the feed; no queue needed at this scale |
| Live data | **football-data.org** free (primary) + admin override | Free, exposes ET/penalty breakdown |
| Leaderboard | Client **polls** `/api/leaderboard` (SWR, ~20–30 s); optional SSE | Full recompute is trivial for 21×104 |
| Export | **Google Sheets API** via a service account | Transparent mirror for the group |
| Reverse proxy / TLS | **Caddy** (auto Let's Encrypt) | One line for HTTPS on the custom domain |
| Cost target | **~$5–12 / month** (one small VPS) | Single box covers 21 users comfortably |

Track B (only if this ever grows far beyond friends): dedicated API service, Redis + BullMQ jobs,
SSE/WebSocket push, multi-provider adapter, materialized leaderboard, full observability. See `02` and `14`.

### 2.9 Deployment target (provided)

* **Domain:** `toto.icywhitephosphor.tech` · **Server (VPS):** `72.56.232.82` (fixed IP, always-on).
* **DNS:** `A  toto.icywhitephosphor.tech → 72.56.232.82` (+ optional `AAAA` if the box has IPv6).
* **TLS:** Let's Encrypt via Caddy/Traefik; ports 80/443 open. HTTPS is **mandatory** for Telegram auth.
* **Telegram binding:** in BotFather, `/setdomain → toto.icywhitephosphor.tech` (Login Widget) and set
  the Mini App URL to `https://toto.icywhitephosphor.tech` (`/newapp` / Menu Button).
* **Shape:** a single **Docker Compose** stack on the VPS — `caddy` + `app` (Next.js) + `worker`
  (node-cron) + `db` (Postgres). Because the box is always-on, polling/cron is a plain long-running
  process; none of the serverless-cron caveats apply. Details in `02` §7 and `12`.

### 2.7 Canonical table names

`users`, `participants`, `tournaments`, `teams`, `groups`, `matches`, `match_results`, `bracket_slots`,
`match_bets`, `bonus_categories`, `bonus_bets`, `bonus_bet_items`, `bonus_outcomes`, `score_events`,
`leaderboard_snapshots`, `audit_log`, `provider_sync_log`, `sheet_export_log`. Full DDL in `04`.

### 2.8 Canonical API surface

Auth `/api/auth/telegram/miniapp`, `/api/auth/telegram/widget`, `/api/auth/logout` · Bootstrap
`/api/bootstrap` · Participant `/api/participants/claim` · Matches `/api/matches`, `/api/matches/:id` ·
Match bets `PUT /api/me/match-bets` · Bonus bets `GET|PUT /api/me/bonus-bets` · Leaderboard
`/api/leaderboard`, `/api/leaderboard/stream` · Reveal `/api/matches/:id/bets`, `/api/bonus/reveal` ·
Admin `/api/admin/import/fixtures`, `PATCH /api/admin/matches/:id/result`, `/api/admin/recalculate`,
`/api/admin/export/sheets`, `/api/admin/provider/status`, `/api/admin/participants/:id/rebind`,
`PATCH /api/admin/bonus/:category/settle`. Full spec in `06`.

---

## 3. Known facts baked in (verified June 2026)

* **48 teams, 12 groups (A–L), 104 matches, 11 Jun – 19 Jul 2026.** Opening match Mexico–South Africa
  at Estadio Azteca; final at MetLife Stadium, New Jersey, 19 Jul.
* The **group composition in your spreadsheet matches the official FIFA final draw exactly** (verified
  group-by-group). It can be used as seed data as-is.
* **Knockout = Round of 32** (top 2 of each group + 8 best third-placed teams), then R16, QF, SF, third
  place, final. The R32 pairings (matches 73–88) and the bracket up to match 104 are fixed; only the
  *identity* of the 8 third-placed teams varies (495 published combinations). See `03`.
* **21 participants** seeded from your file (Вишневский Дмитрий … Якунькин Александр).

Sources are listed at the bottom of `01`, `03`, and `08`.

---

## 4. Status

Proposed architecture, v1. Decisions in §2 are accepted defaults; anything marked "open question" in
`01` §7 needs a ruling from the organizer (you).
