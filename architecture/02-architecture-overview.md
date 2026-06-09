# 02 — Architecture Overview

This document gives the big picture: the C4 diagrams, the stack decision (as an ADR), the two tracks
(pragmatic vs. growth), and the main data flows. Detailed specs live in `04`–`12`.

## 1. System context (C4 level 1)

```mermaid
flowchart TB
    P["Participant (one of 21 friends)<br/>uses Telegram"]
    A["Organizer / Admin (ione)"]
    subgraph TOTO["TOTO WC-2026 (our system)"]
        APP["Web app + API + scoring + jobs"]
        DB[("PostgreSQL<br/>source of truth")]
    end
    TG["Telegram<br/>(identity + bot notifications)"]
    FD["football-data.org<br/>(free results feed)"]
    GS["Google Sheets<br/>(transparency mirror)"]

    P -->|"logs in, places bets, views table"| APP
    A -->|"confirms results, overrides, exports"| APP
    APP <-->|"verify initData / login payload"| TG
    APP -->|"DM reminders & results (optional)"| TG
    APP -->|"poll fixtures & results"| FD
    APP -->|"push export"| GS
    APP --- DB
```

## 2. Containers (C4 level 2) — Track A (recommended)

One Next.js deployment contains the UI, the API (route handlers), the scoring module, and the scheduled
jobs (via platform cron). One managed Postgres. That's the whole system.

```mermaid
flowchart TB
    subgraph Client["Browser / Telegram in-app webview"]
        UI["Next.js React UI (Russian)<br/>SWR polling for leaderboard"]
    end
    subgraph Vercel["Single Next.js deployment"]
        API["API route handlers<br/>/api/*"]
        SCORE["Scoring engine<br/>(pure TS module)"]
        CRON["Cron handlers<br/>(poll, recompute, export)"]
    end
    DB[("PostgreSQL (Supabase/Neon)")]
    TG["Telegram"]
    FD["football-data.org"]
    GS["Google Sheets API"]

    UI -->|"HTTPS JSON"| API
    API --> SCORE
    CRON --> SCORE
    API --> DB
    CRON --> DB
    SCORE --> DB
    API <--> TG
    CRON --> FD
    CRON --> GS
```

Why a single deployment instead of GPT's separate `web` + `api` services: at 21 users there is no scaling
or team-boundary reason to split them, and one deployment halves the moving parts, the config, and the
cost. The scoring engine is still a **separate module** (its own folder + tests) so it can be extracted
later without rewrite.

## 3. Backend components (C4 level 3)

```mermaid
flowchart LR
    subgraph API["API layer (/api)"]
        AUTH["auth<br/>(Telegram verify, session)"]
        PART["participants<br/>(claim/rebind)"]
        MATCH["matches<br/>(list, my-bet)"]
        BETS["bets<br/>(match + bonus, deadline guard)"]
        LB["leaderboard<br/>(read snapshot)"]
        REVEAL["reveal<br/>(post-deadline visibility)"]
        ADMIN["admin<br/>(results, recompute, export)"]
    end
    subgraph CORE["Domain core"]
        SCORING["scoring engine"]
        SETTLE["bonus settlement"]
        BRACKET["bracket resolver"]
        DEADLINE["deadline service<br/>(server clock)"]
    end
    subgraph INTEG["Integrations"]
        PROVIDER["football provider client"]
        SHEETS["sheets exporter"]
        TGBOT["telegram bot (notifications)"]
    end
    DB[("PostgreSQL")]

    AUTH-->DB
    PART-->DB
    MATCH-->DB
    BETS-->DEADLINE-->DB
    BETS-->DB
    LB-->DB
    REVEAL-->DEADLINE
    REVEAL-->DB
    ADMIN-->PROVIDER
    ADMIN-->SCORING
    ADMIN-->SHEETS
    PROVIDER-->BRACKET-->DB
    PROVIDER-->DB
    SCORING-->SETTLE-->DB
    SCORING-->DB
    SHEETS-->DB
```

## 4. Key data flows

### 4.1 Placing a bet (deadline-guarded, idempotent, audited)
```mermaid
sequenceDiagram
    participant U as UI
    participant API as PUT /api/me/match-bets
    participant D as Deadline service
    participant DB as PostgreSQL
    U->>API: { idempotency_key, bets:[{match_id,h,a,x2}] }
    API->>API: authenticate session → participant
    loop each bet
        API->>D: is now < match.deadline_at ? (server clock)
        alt open
            API->>DB: upsert bet (unique participant_id,match_id) + audit_log
        else locked
            API-->>U: include in "rejected" with deadline
        end
    end
    API-->>U: { saved:[...], rejected:[...] }
```

### 4.2 Result → scoring → leaderboard → export
```mermaid
sequenceDiagram
    participant J as Cron poller
    participant FD as football-data.org
    participant DB as PostgreSQL
    participant S as Scoring engine
    participant A as Admin
    participant GS as Google Sheets
    J->>FD: GET matches (during live window)
    FD-->>J: statuses + scores (reg/ET/penalties)
    J->>DB: upsert match_results (source=PROVIDER), provider_sync_log
    alt play-off match just finished
        J->>A: needs confirmation (status=AWAITING_CONFIRM)
        A->>DB: confirm/override toto score (source=ADMIN, confirmed=true)
    end
    DB->>S: results changed → recompute affected score_events
    S->>DB: write score_events + leaderboard_snapshot
    DB->>GS: debounced export job (private + public sheets)
```

### 4.3 Bonus settlement (progressive)
```mermaid
flowchart LR
    GE["Group stage ends"] --> GW["settle GROUP_WINNER"]
    R32["R32 (m73-88) ends"] --> R16P["settle R16_PARTICIPANT"]
    R16["R16 (m89-96) ends"] --> QFP["settle QF_PARTICIPANT (key)"]
    QF["QF (m97-100) ends"] --> SFP["settle SF_PARTICIPANT (key)"]
    SF["SF (m101-102) ends"] --> FIN["settle FINALIST (key)"]
    F["Final (m104) ends"] --> CH["settle CHAMPION (key) + TOP_SCORER"]
```

## 5. ADR-001 — Monolith vs. split services

**Status:** Accepted · **Date:** 2026-06-09 · **Deciders:** ione

**Context.** 21 users, 104 matches, one developer, a deadline this week, and a "free-tier" budget. We
must choose the overall shape: a single full-stack app, or GPT's separated `Next.js web` + `NestJS API`
+ `Redis/BullMQ` + `SSE` topology.

### Options

**Option A — Single Next.js app (recommended)**
| Dimension | Assessment |
|-----------|------------|
| Complexity | **Low** — one repo, one deploy, one env |
| Cost | **~$0–5/mo** — fits free tiers |
| Scalability | Fine to thousands of reads; not our constraint |
| Team familiarity | One stack (TS end-to-end) |
| Time-to-ship | **Fastest** |

Pros: minimal moving parts; fastest path to the deadline; cheap; the scoring engine is still modular.
Cons: cron on serverless has cold-start/timeout quirks (mitigated: short jobs, or a tiny always-on
worker); not "impressive" as a reference architecture.

**Option B — Split services + Redis + BullMQ + SSE (GPT's design)**
| Dimension | Assessment |
|-----------|------------|
| Complexity | **High** — 4+ services, queues, pub/sub |
| Cost | Higher (Redis, extra always-on services) |
| Scalability | Excellent — but unneeded at 21 users |
| Team familiarity | More surface area to operate |
| Time-to-ship | **Slowest** |

Pros: textbook-scalable; clean separation; good portfolio piece. Cons: weeks not days; over-built for
the actual load; more to break (queue stuck, Redis down) for a pool that a spreadsheet handled.

### Decision
Adopt **Option A** for delivery. Keep three internal seams clean so Option B remains a *refactor, not a
rewrite*: (1) scoring is a pure module, (2) the football feed is behind a `FootballProvider` interface,
(3) jobs are plain functions a queue could later call. See `14` for the full side-by-side with GPT.

### Consequences
- Easier: shipping on time, operating, reasoning about correctness.
- Harder: true sub-second "goal flash" live updates (we accept 1–3 min freshness; `10` covers the SSE
  upgrade if you ever want it).
- Revisit when: the pool grows past a few hundred users, or you want push notifications at scale.

## 6. Track A vs. Track B at a glance

| Concern | Track A (now) | Track B (growth) |
|---------|---------------|------------------|
| App | One Next.js deploy | `web` + `api` services |
| Jobs | Platform cron / node-cron | Redis + BullMQ workers |
| Live updates | SWR polling (~20–30 s) | SSE / WebSocket push via Redis pub/sub |
| Providers | football-data.org + manual | Multi-provider adapter w/ failover (API-Football, etc.) |
| Leaderboard | Recompute-on-change + snapshot | Materialized view + incremental |
| Observability | Platform logs + Sentry (free) | Full metrics/tracing/alerting |
| When | 21 friends | Hundreds–thousands of users |

## 7. Deployment topology (Track A) — single VPS

The provided target is a **VPS with a fixed IP**, not a serverless platform:

* **Domain:** `toto.icywhitephosphor.tech` → **A record** → **`72.56.232.82`**.
* **TLS:** Caddy terminates HTTPS with an automatic Let's Encrypt certificate (mandatory for Telegram
  auth). Only 80/443 are exposed publicly; Postgres stays on the internal Docker network.
* Because the box is **always-on**, the poller/cron is just a long-running `worker` process — no
  serverless cold-start, timeout, or "max cron frequency" caveats.

```mermaid
flowchart TB
    subgraph Internet
        USERS["21 participants<br/>(Telegram in-app webview / browser)"]
        TG["Telegram Bot API"]
        FD["football-data.org"]
        GS["Google Sheets API"]
    end
    subgraph VPS["VPS 72.56.232.82 — Docker Compose"]
        CADDY["caddy<br/>:80/:443 → HTTPS<br/>toto.icywhitephosphor.tech"]
        APP["app — Next.js (UI + /api)"]
        WORKER["worker — node-cron<br/>(poll, recompute, export)"]
        PG[("db — Postgres 16<br/>+ volume")]
    end
    SECRETS["/.env (root-only):<br/>BOT_TOKEN, DATABASE_URL, FD_TOKEN,<br/>GOOGLE_SA_JSON, SHEET_ID, JWT_SECRET"]

    USERS -->|HTTPS| CADDY --> APP --> PG
    WORKER --> PG
    APP <-->|verify initData / login| TG
    WORKER --> FD
    WORKER --> GS
    WORKER -. optional DMs .-> TG
    APP -.reads.-> SECRETS
    WORKER -.reads.-> SECRETS
```

Minimal `docker-compose.yml` shape (full version + Caddyfile in `12`):

```yaml
services:
  caddy:   { image: caddy:2, ports: ["80:80","443:443"], depends_on: [app] }     # auto-HTTPS
  app:     { build: ./app, env_file: .env, depends_on: [db] }                     # Next.js
  worker:  { build: ./app, command: ["node","worker.js"], env_file: .env, depends_on: [db] }
  db:      { image: postgres:16, env_file: .env, volumes: ["pgdata:/var/lib/postgresql/data"] }
volumes: { pgdata: {} }
```
```
# Caddyfile
toto.icywhitephosphor.tech {
    reverse_proxy app:3000
}
```

**Managed-Postgres variant:** if you'd rather not self-host the database, drop the `db` service and point
`DATABASE_URL` at Supabase/Neon free — the rest is unchanged. Either way the app + worker live on the VPS.

**Serverless variant (not chosen):** the same app deploys to Vercel/Render with managed Postgres and
platform cron; we keep it as a fallback only because a fixed-IP VPS was provided. See `12` for hosting
choices, secrets handling, backups, firewall, and the monthly cost breakdown.
