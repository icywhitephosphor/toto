# 12 — Security, Fairness, Operations & Cost

Audience: architect / developer. Cross-references: `02` §7 (VPS topology), `04` (audit_log), `05`
(scoring), `06` (API spec), `07` (Telegram auth), `08` (live results), `09` (Sheets export).

---

## 1. Threat model

This is a **trusted-friend pool**, not a fintech product. The realistic adversary is a motivated
participant who wants to win, not a nation-state. Size the defences accordingly — but remember the
app is **public on the internet**, so opportunistic scanners and bots are a real second tier.

| # | Threat | Actor | Likelihood | Primary mitigation |
|---|--------|-------|:----------:|--------------------|
| T1 | Peek at a friend's bet before the match deadline | Motivated participant | High (obvious incentive) | Bets returned only after `matches.deadline_at`; reveal endpoints check `now() > deadline_at` server-side; DB rows always visible to the app, but the API never serves other participants' `pred_home`/`pred_away` until the window closes |
| T2 | Impersonate another participant (claim their name) | Participant or stranger | Medium | Participant roster is a fixed allow-list (21 pre-seeded names); `participants.user_id UNIQUE` prevents double-claim; only one Telegram account may hold a claim (`users.telegram_id UNIQUE`); admin can rebind (`PATCH /api/admin/participants/:id/rebind`) |
| T3 | Edit a bet after the deadline or alter a result | Participant / admin error | Low–medium | API returns 423 once `now() >= deadline_at`; `match_bets.version` increments on every upsert; `audit_log` captures `before`/`after` JSON on every write; scoring is re-runnable from the audit trail; play-off results require `confirmed = true` before scoring applies |
| T4 | Accidental data loss (disk failure, bad migration, bad deploy) | Ops/infra | Low (VPS is small, always-on) | Nightly `pg_dump` + off-box copy; Google Sheets export is a human-readable secondary copy; documented restore procedure (§6) |
| T5 | BOT_TOKEN or JWT_SECRET leak | Developer error, exposed `.env` | Low | `.env` is `root:root 600`; never committed to git; never injected into client bundles (`NEXT_PUBLIC_*` convention strictly avoided for secrets); secrets referenced only by `app` and `worker` containers |
| T6 | DB password/connection string leak | Same | Low | `DATABASE_URL` in the same root-only `.env`; Postgres port **not** exposed outside Docker network (no `ports:` mapping on `db` service); only `app` and `worker` can reach it via the internal `toto_net` bridge |
| T7 | Internet bots / scrapers | Random bots | Medium (anything on 443) | Rate limiting (§4); Telegram-auth-only write paths; public leaderboard is read-only and contains no secrets |
| T8 | SQL / input injection | Automated scanner, participant | Low | Parameterized queries via Drizzle ORM; Zod input validation on all route handlers; no raw SQL interpolation |
| T9 | Brute-force login / token replay | Bot or ex-friend | Low | Telegram HMAC is a one-time-use signed payload with `auth_date`; JWT is short-lived (e.g. 7 days), httpOnly, not exposed to JS; per-IP rate limit on auth endpoints |
| T10 | Denial of service | Random / malicious | Very low | Single VPS with 21 real users; Caddy handles connection limits; rate limiting deters trivial floods; not a high-value target |

**What we deliberately do not mitigate at this scale:** certificate pinning, WAF, DDoS protection,
hardware security modules, SOC 2. Those are disproportionate for a friends' pool.

---

## 2. Fairness & anti-cheat controls

Every control maps to a concrete mechanism in the codebase.

| Fairness invariant | Mechanism | Where |
|--------------------|-----------|-------|
| Deadline is server-authoritative | API checks `now() >= matches.deadline_at` (server clock, UTC); returns 423 Locked with the deadline timestamp; client only reflects it | `06` §bet endpoints, `11` §deadline service |
| Bets are secret until deadline | Reveal endpoints (`/api/matches/:id/bets`, `/api/bonus/reveal`) gate on `now() > deadline_at`; listing endpoints return own bets only | `06` §reveal |
| Bets are immutable after deadline | Upsert path exits early with 423; no admin endpoint for post-deadline bet edits; only result + scoring admin actions exist | `06` §write guards |
| One Telegram ↔ one participant | `users.telegram_id UNIQUE`, `participants.user_id UNIQUE` at DB level; claim endpoint 409s on conflict | `04` §2, `07` §claim |
| No double-bet per match / category | `match_bets UNIQUE(participant_id, match_id)`, `bonus_bets UNIQUE(participant_id, category_id)` | `04` §5 |
| Every bet write is audited | `audit_log` row inserted (same transaction) with `before`/`after` JSON, `actor_user_id`, `ip`, `user_agent` | `04` §7 |
| Every result change is audited | `audit_log` row with `action='RESULT_OVERRIDE'` on every `PATCH /api/admin/matches/:id/result` | `04` §7, `06` §admin |
| Play-off results require admin confirm | `match_results.confirmed = false` until admin explicitly confirms; scoring engine skips unconfirmed rows | `04` §4, `05` §scoring |
| Scoring is deterministic and re-runnable | Pure function with no external I/O; every worked example is a unit test; can re-derive from `match_results` + `match_bets` + `bonus_outcomes` at any point | `05` |
| Bonus deadline is a single hard cut-off | All seven bonus categories lock together at `tournaments.bonus_deadline_at` = 2026-06-10 20:00 UTC | `04` §3, `11` §bonus deadline |

---

## 3. AuthZ / RBAC

### 3.1 Roles

| Role | How granted | What it can do |
|------|-------------|----------------|
| **Public** | No auth | `GET /api/leaderboard` (post-tournament reveal only), `GET /api/bootstrap` (tournament metadata, teams, match list without bets) |
| **Participant** | Valid JWT (from Telegram HMAC) mapped to a `participants` row | Read own bets, submit/update bets before deadline, read revealed bets post-deadline, view leaderboard |
| **Admin** | `users.is_admin = true` on the claimed user row; set by a migration or one-time SQL after first login | All participant actions plus: import fixtures, patch results, confirm play-off scores, trigger recompute, trigger Sheets export, rebind participants |

Admin is granted by a one-time SQL update on the VPS after the organizer (Гулькин Иван) first logs
in and claims their name:

```sql
UPDATE users SET is_admin = true WHERE telegram_id = <your_telegram_id>;
```

The `is_admin` flag is baked into the JWT payload at login time. On every privileged request the
middleware re-reads the `users` row to confirm the flag is still set — no stale JWT can retain admin
after revocation.

### 3.2 Endpoint permission matrix

| Endpoint | Public | Participant | Admin |
|----------|:------:|:-----------:|:-----:|
| `GET /api/bootstrap` | Y | Y | Y |
| `GET /api/matches` | — | Y | Y |
| `GET /api/matches/:id` | — | Y | Y |
| `GET /api/me/match-bets` | — | Y (own only) | Y |
| `PUT /api/me/match-bets` | — | Y (pre-deadline) | Y |
| `GET /api/me/bonus-bets` | — | Y (own only) | Y |
| `PUT /api/me/bonus-bets` | — | Y (pre-deadline) | Y |
| `GET /api/leaderboard` | Y | Y | Y |
| `GET /api/matches/:id/bets` | — | Y (post-deadline) | Y |
| `GET /api/bonus/reveal` | — | Y (post-deadline) | Y |
| `POST /api/participants/claim` | — | Y (unclaimed only) | Y |
| `POST /api/admin/**` | — | — | Y |
| `PATCH /api/admin/matches/:id/result` | — | — | Y |
| `PATCH /api/admin/bonus/:category/settle` | — | — | Y |

### 3.3 Principle of least privilege

**Google service account:** editor access granted on exactly two spreadsheets
(`SHEET_ID_PRIVATE`, `SHEET_ID_PUBLIC`) and nothing else. The `GOOGLE_SA_JSON` key is stored
only in `.env`; it is not committed and not sent to the client.

**Database user:** create a dedicated `toto_app` role for the app/worker:

```sql
CREATE ROLE toto_app LOGIN PASSWORD '<strong-password>';
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO toto_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO toto_app;
-- No CREATE TABLE, no DROP, no TRUNCATE on production data.
```

Migrations run as the superuser (`postgres`) in a one-off step, not as `toto_app`.

---

## 4. Hardening

### 4.1 HTTPS & security headers

Caddy issues a Let's Encrypt certificate automatically. The Caddyfile also sets security headers:

```
# /etc/caddy/Caddyfile  (full version — expand the stub from 02 §7)
toto.icywhitephosphor.tech {
    reverse_proxy app:3000

    # Automatic HTTPS + HSTS (Caddy default: 12-month max-age)
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options    "nosniff"
        X-Frame-Options           "DENY"
        Referrer-Policy           "strict-origin-when-cross-origin"
        Content-Security-Policy   "default-src 'self'; img-src 'self' https://t.me data:; script-src 'self' https://telegram.org; frame-ancestors 'none'"
        -Server
    }

    log {
        output file /var/log/caddy/access.log {
            roll_size 10mb
            roll_keep 7
        }
    }
}
```

### 4.2 Input validation & queries

- All request bodies parsed with **Zod** schemas before any DB access.
- All DB access via **Drizzle ORM** with parameterized placeholders — no string interpolation.
- Score values validated: `pred_home` / `pred_away` are integers `0..99` (DB CHECK mirrors the Zod schema).

### 4.3 Rate limiting

A lightweight in-process middleware (or Caddy `rate_limit` module) limits requests:

```typescript
// src/middleware/rateLimit.ts  (simple in-memory using `lru-cache`)
// 60 requests / minute per IP for general API
// 5 requests / minute per IP on /api/auth/* endpoints
```

Caddy alternative (no plugin needed for basic protection):

```
# inside the site block — requires caddy-ratelimit or use Next.js middleware
rate_limit {remote_ip} 60r/m
```

For a 21-person pool, this is more than enough to block scrapers without inconveniencing anyone.

### 4.4 Cookie flags

The session JWT is set as:

```
Set-Cookie: toto_session=<jwt>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800
```

- `HttpOnly`: no JS access.
- `Secure`: HTTPS-only (enforced by Caddy).
- `SameSite=Strict`: CSRF protection; the Telegram Mini App opens in a webview on the same
  effective origin, so this works.

### 4.5 Secret management

| Secret | Used by | Never sent to |
|--------|---------|---------------|
| `BOT_TOKEN` | `app` (auth verify), `worker` (DMs) | Client, git, logs |
| `JWT_SECRET` | `app` (sign + verify) | Client, git, logs |
| `DATABASE_URL` | `app`, `worker` | Client, git, logs |
| `FD_TOKEN` | `worker` | Client |
| `GOOGLE_SA_JSON` | `worker` | Client |
| `SHEET_ID_PRIVATE` | `worker` | Client (public sheet ID is fine) |

The root `.env` file:

```bash
chmod 600 /opt/toto/.env
chown root:root /opt/toto/.env
```

Next.js convention: any variable without the `NEXT_PUBLIC_` prefix is server-only; the build
verifier (`eslint-plugin-next`) flags accidental exposure.

### 4.6 Telegram domain binding

In BotFather:
- `/setdomain → toto.icywhitephosphor.tech` (Login Widget — restricts the domain check).
- Mini App URL set to `https://toto.icywhitephosphor.tech`.

The HMAC verification in `07` already rejects payloads with `auth_date` older than 120 seconds,
preventing replay attacks.

### 4.7 CORS

The Next.js API allows requests only from the app's own origin. Explicitly set in the route
handler wrapper:

```typescript
// src/lib/cors.ts
const ALLOWED_ORIGIN = "https://toto.icywhitephosphor.tech";
// set Access-Control-Allow-Origin to ALLOWED_ORIGIN only; reject others
```

Telegram Mini App webviews load from `https://toto.icywhitephosphor.tech`, so same-origin applies;
no wildcard CORS needed.

### 4.8 Dependency hygiene

- `npm audit` in CI / before each deploy; patch `high` + `critical` before shipping.
- `npm outdated` review monthly (the tournament runs ~6 weeks).
- Lock file (`package-lock.json`) committed; Docker build uses `npm ci`.

---

## 5. Operations on the VPS

### 5.1 Firewall (ufw)

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp     # SSH
ufw allow 80/tcp     # Caddy → Let's Encrypt HTTP-01 + redirect
ufw allow 443/tcp    # Caddy HTTPS
ufw enable
# Postgres is NOT in this list — it stays on the internal Docker network only.
```

Verify Postgres is unreachable from outside:

```bash
# From your local machine — should time out or refuse:
nc -zv 72.56.232.82 5432
```

### 5.2 SSH hardening

```
# /etc/ssh/sshd_config additions
PasswordAuthentication no
PermitRootLogin prohibit-password   # or 'no' if you use a non-root deploy user
PubkeyAuthentication yes
AuthorizedKeysFile .ssh/authorized_keys
```

Deploy with a dedicated non-root user (`toto`) that can run `docker compose` via a `docker` group
membership or `sudo` for compose commands only.

### 5.3 Full docker-compose.yml

```yaml
# /opt/toto/docker-compose.yml
version: "3.9"

networks:
  toto_net:
    driver: bridge

volumes:
  pgdata:
  caddy_data:
  caddy_config:

services:
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    networks: [toto_net]
    depends_on: [app]

  app:
    build:
      context: .
      dockerfile: Dockerfile
    restart: unless-stopped
    env_file: .env
    environment:
      NODE_ENV: production
      PORT: "3000"
    networks: [toto_net]
    depends_on:
      db:
        condition: service_healthy

  worker:
    build:
      context: .
      dockerfile: Dockerfile
    command: ["node", "dist/worker.js"]
    restart: unless-stopped
    env_file: .env
    environment:
      NODE_ENV: production
    networks: [toto_net]
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:16-alpine
    restart: unless-stopped
    env_file: .env                    # POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB
    volumes:
      - pgdata:/var/lib/postgresql/data
    networks: [toto_net]
    # No 'ports:' — intentionally internal-only
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB"]
      interval: 10s
      timeout: 5s
      retries: 5
```

### 5.4 Caddyfile

```
# /opt/toto/Caddyfile
toto.icywhitephosphor.tech {
    reverse_proxy app:3000

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options    "nosniff"
        X-Frame-Options           "DENY"
        Referrer-Policy           "strict-origin-when-cross-origin"
        -Server
    }

    log {
        output file /var/log/caddy/access.log {
            roll_size 10mb
            roll_keep 7
        }
    }
}
```

### 5.5 Deploy flow

```bash
# On the VPS as the deploy user:
cd /opt/toto
git pull origin main
docker compose build --no-cache          # or tag-based: docker pull myregistry/toto:v1.2
docker compose up -d
docker compose exec app npx drizzle-kit migrate   # run pending migrations
docker compose ps                                  # verify all containers Up
curl -sf https://toto.icywhitephosphor.tech/api/health | jq .
```

For zero-downtime: build the new image with a version tag, swap with `docker compose up -d` (Caddy
keeps accepting connections during the container restart).

### 5.6 Health endpoint

```typescript
// src/app/api/health/route.ts
export async function GET() {
  try {
    await db.execute(sql`SELECT 1`);
    return Response.json({ ok: true, db: "up", ts: new Date().toISOString() });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 503 });
  }
}
```

UptimeRobot and the deploy script both hit `GET /api/health`.

### 5.7 Log handling

| Log source | Location | Retention |
|-----------|----------|-----------|
| Caddy access | `/var/log/caddy/access.log` (rolled by Caddy) | 7 × 10 MB |
| Docker `app` stdout | `docker compose logs app` | default 10 MB JSON-file driver |
| Docker `worker` stdout | `docker compose logs worker` | same |
| Postgres | inside Docker; `docker compose logs db` | default |
| Structured app logs | Sentry (errors) + `audit_log` / `provider_sync_log` / `sheet_export_log` tables | kept in DB |

Set Docker log driver limit in `/etc/docker/daemon.json`:

```json
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "5" }
}
```

---

## 6. Backups & recovery

### 6.1 Nightly pg_dump

```bash
# /opt/toto/scripts/backup.sh  (run by root cron: 0 3 * * *)
#!/usr/bin/env bash
set -euo pipefail
DATE=$(date +%Y%m%d)
DEST=/opt/toto/backups
mkdir -p "$DEST"

docker compose -f /opt/toto/docker-compose.yml exec -T db \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" \
  | gzip > "$DEST/toto_${DATE}.sql.gz"

# Keep last 14 days locally
find "$DEST" -name "toto_*.sql.gz" -mtime +14 -delete

# Copy off-box: choose one —
# Option A: rsync to another host
# rsync -az "$DEST/toto_${DATE}.sql.gz" backup-host:/backups/toto/
# Option B: upload to S3-compatible object storage (Backblaze B2 free 10 GB)
# rclone copy "$DEST/toto_${DATE}.sql.gz" b2:toto-backups/
```

Add to root crontab:

```
0 3 * * * /opt/toto/scripts/backup.sh >> /var/log/toto-backup.log 2>&1
```

**Retention:** 14 days local, 90 days off-box.

### 6.2 Restore procedure

```bash
# 1. Stop the app and worker (keep db running):
docker compose stop app worker

# 2. Drop and recreate the database:
docker compose exec db psql -U "$POSTGRES_USER" -c "DROP DATABASE IF EXISTS toto_restore;"
docker compose exec db psql -U "$POSTGRES_USER" -c "CREATE DATABASE toto_restore;"

# 3. Restore the dump:
gunzip -c /opt/toto/backups/toto_20260612.sql.gz \
  | docker compose exec -T db psql -U "$POSTGRES_USER" toto_restore

# 4. Verify row counts, then rename:
docker compose exec db psql -U "$POSTGRES_USER" \
  -c "SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY relname;" toto_restore

# 5. Swap databases (requires a brief downtime):
#    Update DATABASE_URL in .env to point at toto_restore (or rename via pg).
#    Then restart:
docker compose up -d app worker
```

**Test-restore reminder:** run a restore into a throw-away container after each major deploy and
before the tournament starts (2026-06-11). A backup that has never been restored is an assumption,
not a guarantee.

### 6.3 Google Sheets as a secondary copy

The private Sheets tab is a **human-readable audit mirror**, not a backup. It has no schema, no
referential integrity, and no transaction history. It is useful for spot-checking and for the
organizer to share results with the group. Do not rely on it for disaster recovery.

---

## 7. Monitoring & alerting (all free tier)

| Tool | What it watches | How |
|------|-----------------|-----|
| **UptimeRobot** (free) | `GET https://toto.icywhitephosphor.tech/api/health` every 5 min | HTTP monitor; email + optional Telegram notification on down |
| **Sentry** (free, 5 k events/mo) | Unhandled exceptions in `app` and `worker` | `@sentry/nextjs` SDK; `Sentry.init()` in `instrumentation.ts` |
| **`provider_sync_log`** (DB) | Per-poll success/failure; `quota_remaining` from `X-Requests-Available-Minute` header | Worker logs each poll; a simple daily cron query alerts if `ok=false` count > 3 |
| **`sheet_export_log`** (DB) | Export success/failure | Same pattern — alert on consecutive failures |
| **Telegram DM to admin** | Worker job failure | Worker catches errors and calls `sendMessage` to the admin's `telegram_id` via `BOT_TOKEN` |

Minimum alerting wired into the worker:

```typescript
async function alertAdmin(message: string) {
  await fetch(
    `https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: ADMIN_TELEGRAM_ID, text: `[TOTO alert]\n${message}` }),
    }
  );
}
// Called in every catch block of the cron jobs.
```

---

## 8. Runbook

### 8.1 Football data provider is down / returning errors

1. Check `provider_sync_log` for the last successful poll and the HTTP status.
2. Verify the provider status page (football-data.org status).
3. If the match has already finished and the score is known: enter the result manually via
   `PATCH /api/admin/matches/:id/result` (see `08` §manual override policy).
4. Set `source = 'ADMIN'`, confirm if it is a play-off match (`confirmed = true`).
5. Trigger `POST /api/admin/recalculate` to recompute scores.
6. Once the provider recovers, the next poll will upsert the result with `source = 'PROVIDER'`;
   admin confirmation must be re-applied if the toto score differs.

### 8.2 Sheets export failing

1. Check `sheet_export_log` for the error field.
2. Common causes: service account token expired (rotate key in Google Cloud Console, update
   `GOOGLE_SA_JSON` in `.env`, `docker compose up -d`); quota exceeded (Sheets API free limit is
   generous; unlikely).
3. The failure is **non-critical** — the DB is the source of truth and scoring is unaffected.
4. Re-trigger manually: `POST /api/admin/export/sheets`.

### 8.3 Wrong result entered / scoring incorrect

1. Admin patches the result: `PATCH /api/admin/matches/:id/result` with the correct `toto_home` /
   `toto_away` and sets `confirmed = true`. Full audit entry is written to `audit_log`.
2. Trigger recompute: `POST /api/admin/recalculate`. Scoring is deterministic — re-running it on
   corrected data yields the correct scores (see `05`, `06`).
3. The leaderboard snapshot is updated automatically after recompute.
4. Sheets export re-runs (or trigger manually).

### 8.4 Suspected bad deploy / rollback

```bash
# Identify the previous image tag (if using tags) or the last known-good commit:
docker images | grep toto

# Roll back to a specific image tag:
docker compose stop app worker
docker tag toto-app:v1.1 toto-app:current      # or edit docker-compose.yml image: field
docker compose up -d app worker

# If using git-based builds and the migration was additive (no destructive DDL):
git checkout v1.1
docker compose build app worker
docker compose up -d
```

If a migration was destructive, restore from backup (§6.2) before rolling back.

---

## 9. Monthly cost

| Component | Provider | Cost |
|-----------|----------|-----:|
| VPS (1–2 vCPU, 2–4 GB RAM; e.g. Hetzner CX21, DigitalOcean Basic, Vultr) | VPS host | **$5–12/mo** |
| Domain (`icywhitephosphor.tech`, amortized monthly) | Registrar | **~$1–2/mo** |
| TLS certificate (Let's Encrypt via Caddy) | Let's Encrypt | **$0** |
| Football data feed (football-data.org free tier, 10 req/min) | football-data.org | **$0** |
| Google Sheets API | Google | **$0** |
| Telegram bot & auth | Telegram | **$0** |
| Error tracking (Sentry free, 5 k events/mo) | Sentry | **$0** |
| Uptime monitoring (UptimeRobot free, 50 monitors) | UptimeRobot | **$0** |
| Off-box backup storage (Backblaze B2 free 10 GB) | Backblaze | **$0** |
| **Total** | | **~$6–14/mo** |

**The one thing that costs more:** if you want near-real-time results (under 1 minute) or higher
request limits, upgrading to a paid football data feed is the only optional cost. The
API-Football Starter plan is ~$10/mo; football-data.org Tier 1 is €12/mo. For a friends' pool
with 104 matches over 6 weeks, the free tier (1-minute polling is fine given the 10 req/min
limit) is sufficient.

The VPS cost is the only mandatory recurring expense. The total is $5–12/mo at the low end; it
stays there for the entire tournament with no surprises.
