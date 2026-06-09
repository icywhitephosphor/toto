# 14 — Review of the GPT Draft

You asked for an honest assessment of the earlier GPT design. Short version: **it's a competent, well-organized
draft with the right backbone and correct rule maths — but it is over-engineered for 21 friends, unrealistic
on the timeline, makes one real technical mistake (Telegram), one real factual mistake (free-tier polling),
and skips several WC-2026-specific hard parts.** This doc set keeps GPT's good instincts and fixes the rest.

This is a critique of an engineering document, not of you or of using GPT — the draft is a solid starting point.

## 1. Verdict at a glance

| Dimension | GPT draft | This doc set |
|-----------|-----------|--------------|
| Core backbone (DB = truth, server deadlines, pure scoring) | ✅ Correct | ✅ Same, kept |
| Rule maths (points, ×2, penalty +1) | ✅ Correct | ✅ Verified as runnable tests (`05`, `15`) |
| Right-sizing for 21 users | ❌ Over-built (Redis, BullMQ, SSE, NestPlusNext, multi-provider, matviews) | ✅ One Next.js app + Postgres + node-cron |
| Timeline realism | ❌ "Build it all in 3 days" | ✅ Phased; Phase 0 keeps bonus in the sheet (`13`) |
| Telegram auth correctness | ⚠️ Login-Widget only; Mini App secret would be wrong | ✅ Both schemes, correct derivations (`07`) |
| Free-tier live data | ❌ API-Football "every 15 s" breaks the 100/day free cap | ✅ football-data.org 10/min + quota-aware schedule (`08`) |
| WC-2026 bracket / 3rd-place / R32 | ❌ Not modelled | ✅ Matches 73–104 + 495-combo handling (`03`) |
| Bonus settlement timing | ❌ Not specified | ✅ Per-category triggers, progressive leaderboard (`05`) |
| Stage-name mapping (1/16 ↔ R32) | ❌ Glossed over | ✅ Explicit table; fixes the off-by-one-round trap (`03 §1`) |
| Draw-in-play-off edge case | ❌ Missing | ✅ Handled in data model + UX (`01 §7.3`, `05 §3`) |
| Top-scorer ties / prize-split ties | ❌ Missing/uns­ound | ✅ Flagged as organizer rulings (`01 §7`) |
| "по росту :)" tie-break | ❌ Omitted | ✅ Included as level-4 tie-break (`05 §5`) |
| Cost estimate, backups, runbook, firewall | ⚠️ Thin | ✅ Concrete (`12`) |

## 2. What GPT got right (keep it)

These are genuinely good calls and we kept every one:

1. **PostgreSQL is the source of truth; Google Sheets is export-only.** This is the single most important
   decision and GPT led with it. ✔
2. **Deadlines enforced server-side**, client only reflects them. ✔ (`11`)
3. **Bets hidden until their deadline.** Correct framing of the core fairness requirement. ✔
4. **Scoring as a separate, pure, unit-tested module**, with the rules-sheet examples as the test cases. ✔
   We made this literal and runnable (`05 §6`, verified in `15`).
5. **Canonical play-off score** via "+1 goal to the shootout winner." Concept correct. ✔ (`05 §2`)
6. **Manual admin override** of results as a safety net. ✔ — we go further and make admin confirmation
   *mandatory* for the 32 play-off results (`08`).
7. **A `FootballProvider` interface** so the data source is swappable. ✔ — we keep the seam but ship one
   implementation (the multiple implementations are a Track B nicety, not day-one work).
8. **Idempotency key + partial-save** on batch bet submission. ✔ (`06`)
9. **Audit logging** and a deterministic full-recompute. ✔
10. The points values, the ×2 rule (including the negative case), and which bonus categories are "key"
    tie-breakers are all **numerically correct**. ✔

So the skeleton is right. The problems are proportion, realism, a couple of accuracy bugs, and missing
domain specifics.

## 3. What's wrong or inaccurate (fix these)

### 3.1 Telegram: the Mini App secret key is different (real bug risk)
GPT shows only the **Login Widget** verification and uses `secretKey = sha256(botToken)`. That's correct
**for the Login Widget** — but GPT also recommends a Telegram **Mini App** without noting that Mini App
`initData` uses a **different** secret: `secret_key = HMAC_SHA256(key="WebAppData", message=bot_token)`.
If you build the Mini App and verify with `sha256(botToken)`, **every login fails.** GPT also links the
*legacy* widget doc. We document both schemes with correct, side-by-side code and call out the difference
as the common bug (`07 §3`).

### 3.2 Free-tier polling math doesn't add up
GPT recommends **API-Football as the primary feed** with "polling every 15 seconds" during live matches.
API-Football's **free plan is 100 requests per *day*** (resets 00:00 UTC). Polling every 15 s is
~5,760 requests/day — you'd exhaust the daily quota in about **15 minutes**. For a genuinely free build
this is the wrong primary. We pick **football-data.org** (free = **10 requests/minute**, and it exposes
the regular/extra-time/penalty breakdown needed for the canonical score), poll only during match windows,
and track quota from the response headers (`08`). API-Football is documented as a *paid* upgrade for true
real-time.

### 3.3 The "по росту :)" tie-break is missing
The rules sheet lists three extra tie-breakers; the last is literally "по росту :)" (by height — a joke).
GPT reproduced the first two and silently dropped the third, then added a `participant_id` fallback. We
keep the joke as the level-4 manual tie-break **and** add the deterministic fallback, and we flag the real
question it implies — *how to split actual prize money on a true tie* — as an organizer ruling
(`01 §7.2`), because "measure their height" can't settle 18,000 ₽.

## 4. What's missing (the WC-2026 hard parts)

GPT's design is tournament-agnostic, so it skipped the parts that make **2026** specifically tricky:

1. **Round of 32 + "8 best third-placed teams."** 2026 is the first 48-team World Cup; the knockout starts
   at a Round of 32 fed by 12 group winners, 12 runners-up, and the **8 best of the 12 third-placed teams**
   (495 published combinations decide who plays whom). GPT models none of this. We give the full match
   73–104 bracket and two resolution strategies (`03 §4–5`).
2. **Stage-name mapping.** The pool says "1/16 финала / 1/8 финала"; 2026 calls these the Round of 32 /
   Round of 16. Critically, the bonus category **"участники 1/8 финала" = the 16 teams that *reach* the
   Round of 16 = the winners of the Round of 32**, so it settles after match 88 — not after the group
   stage. Miss this and the bonus scores a round early. We pin it down (`03 §1`, `05 §4`).
3. **Bonus settlement timing.** GPT lists the bonus categories but never says **when** each one scores.
   The leaderboard must fill bonus points **progressively** (group winners after the groups, QF
   participants after the R16, etc.). We define per-category triggers (`00 §2.3`, `05 §4`).
4. **Draw predictions in play-offs.** Because the toto score is always decisive, predicting a draw for a
   play-off can never win the outcome — and with ×2 it's a guaranteed penalty. GPT doesn't mention this.
   We handle it in the data model and propose a clean UX (enter the regulation score, then pick the
   shootout winner; the app derives the toto bet) (`01 §7.3`, `05 §3`, `06`).
5. **Top-scorer ties.** If players finish level on goals, FIFA's Golden Boot uses assists then minutes.
   Does any co-leader count for the 7 points, or only the official winner? GPT is silent; we make it an
   explicit ruling with a default (`01 §7.1`).
6. **Concrete tournament data.** GPT links FIFA but doesn't bring in the actual groups, dates, venues, or
   bracket. We verified the official draw (it matches your spreadsheet exactly) and seeded teams, groups,
   the 104-match structure, and the calendar (`03`).

## 5. What's over-engineered (right-size it)

None of this is *wrong* — it's just disproportionate to 21 friends and ~104 matches, and it would cost
you the weeks you don't have. Each is demoted to a **Track B growth option** (`02 §6`):

| GPT chose | Why it's overkill here | Track A instead |
|-----------|------------------------|-----------------|
| Separate NestJS/Fastify API **and** Next.js web | No scaling/team reason at 21 users | One Next.js app (UI + API routes) |
| **Redis + BullMQ** job queue | A handful of jobs/day; an always-on VPS already runs cron | `node-cron` worker process |
| **SSE + Redis pub/sub** live leaderboard | ≤50 viewers; the feed itself lags minutes | SWR polling ~20–30 s (optional in-process SSE) |
| **Materialized** leaderboard + incremental scoring | Full recompute is <1 s for 21×~111 units | Recompute-on-change + a JSON snapshot |
| **Multi-provider** adapter (3 impls) from day one | One free provider + admin override is plenty | One impl behind the interface |
| 5-section **admin panel** | A few admin actions suffice | Minimal admin endpoints (`06`) |

The instinct ("make it scalable") is fine; the timing is wrong. We kept three clean seams — pure scoring,
a provider interface, and jobs-as-plain-functions — so adopting Track B later is a *refactor, not a
rewrite* (`02` ADR-001).

## 6. Timeline realism

GPT proposes a "Day 1 / Day 2 / Day 3" plan that stands up Postgres, Telegram auth, fixtures import, both
bet UIs, scoring, leaderboard, Sheets export, **plus** live sync, queues, SSE, an admin panel, and
notifications — for one person, in three days, with the bonus deadline **tomorrow**. That won't happen.
Our `13` is blunt about it: keep this year's **bonus** round in the existing sheet/Telegram (Phase 0),
and build the app to run the **match-betting** phase that lasts until 19 July, shipping in honest phases.

## 7. Side-by-side stack

| Layer | GPT | This design (Track A) |
|-------|-----|------------------------|
| Frontend | Next.js/React | Next.js/React (UI in Russian) |
| Backend | NestJS or Fastify (separate) | Next.js route handlers (same app) |
| DB | PostgreSQL | PostgreSQL ✔ (same) |
| ORM | Prisma/Drizzle | Drizzle/Prisma ✔ |
| Queue | BullMQ + Redis | none — node-cron worker |
| Realtime | SSE (→ WebSocket) + Redis pub/sub | SWR polling; optional in-process SSE |
| Auth | Telegram Login Widget | Telegram Mini App (Widget fallback), both schemes correct |
| Live data | API-Football primary (paid-grade polling) | football-data.org free + admin confirm |
| Deploy | Railway/Render/Fly/Hetzner | One Docker Compose on the given VPS (72.56.232.82), Caddy HTTPS |
| Cost | unstated | ~$5–12/mo, itemised (`12`) |

## 8. Bottom line

GPT gave you a **correct skeleton and a tidy survey** of the problem — keep its backbone. It under-delivers
on exactly the things that decide whether this ships and stays fair for *your* pool: it's sized for a
product, not for 21 friends; it's optimistic about the calendar; it has a Telegram bug and a free-tier
quota bug; and it skips the 2026 bracket, the bonus-settlement timing, and a few rule edge cases. This doc
set keeps what's right, corrects what's wrong, fills the gaps, and right-sizes the build — while leaving a
clean path to GPT's bigger architecture if the pool ever outgrows the friends' table.
