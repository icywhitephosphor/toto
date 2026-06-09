-- TOTO WC-2026 — canonical schema.
-- Table/column names are verbatim from architecture/04-data-model.md (§§2–7).
-- PostgreSQL 16+: gen_random_uuid() is built in; no extension needed.

-- ---------------------------------------------------------------------------
-- 2. Identity & roster
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id     bigint UNIQUE NOT NULL,
  username        text,
  first_name      text,
  last_name       text,
  photo_url       text,
  is_admin        boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_login_at   timestamptz
);

CREATE TABLE participants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid UNIQUE REFERENCES users(id),
  roster_no       int  UNIQUE NOT NULL,
  display_name    text UNIQUE NOT NULL,
  status          text NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('ACTIVE','DISABLED')),
  tiebreak_rank   int,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 3. Tournament, groups, teams
-- ---------------------------------------------------------------------------
CREATE TABLE tournaments (
  id                   text PRIMARY KEY,
  name                 text NOT NULL,
  display_tz           text NOT NULL DEFAULT 'Europe/Moscow',
  bonus_deadline_at    timestamptz NOT NULL,
  match_deadline_lead  interval NOT NULL DEFAULT '3 hours',
  starts_at            timestamptz,
  ends_at              timestamptz
);

CREATE TABLE groups (
  tournament_id   text NOT NULL REFERENCES tournaments(id),
  code            text NOT NULL,
  name            text,
  PRIMARY KEY (tournament_id, code)
);

CREATE TABLE teams (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id     text NOT NULL REFERENCES tournaments(id),
  group_code        text NOT NULL,
  code              text NOT NULL,
  name_ru           text NOT NULL,
  name_en           text NOT NULL,
  fifa_code         text,
  provider_team_id  text,
  logo_url          text,
  UNIQUE (tournament_id, code),
  FOREIGN KEY (tournament_id, group_code) REFERENCES groups(tournament_id, code)
);
CREATE INDEX teams_group_idx ON teams (tournament_id, group_code);
CREATE INDEX teams_provider_idx ON teams (provider_team_id);

-- ---------------------------------------------------------------------------
-- 4. Matches & results
-- ---------------------------------------------------------------------------
CREATE TABLE matches (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id     text NOT NULL REFERENCES tournaments(id),
  fifa_match_no     int  NOT NULL,
  stage             text NOT NULL
                      CHECK (stage IN ('GROUP','R32','R16','QF','SF','THIRD','FINAL')),
  group_code        text,
  home_team_id      uuid REFERENCES teams(id),
  away_team_id      uuid REFERENCES teams(id),
  home_slot         text,
  away_slot         text,
  kickoff_at        timestamptz,
  deadline_at       timestamptz,
  venue             text,
  city              text,
  status            text NOT NULL DEFAULT 'SCHEDULED'
                      CHECK (status IN ('SCHEDULED','LIVE','AWAITING_CONFIRM','FINAL','CANCELLED')),
  x2_allowed        boolean NOT NULL DEFAULT false,
  provider_match_id text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, fifa_match_no)
);
CREATE INDEX matches_stage_idx ON matches (stage);
CREATE INDEX matches_kickoff_idx ON matches (kickoff_at);
CREATE INDEX matches_deadline_idx ON matches (deadline_at);
CREATE INDEX matches_status_idx ON matches (status);

CREATE TABLE match_results (
  match_id          uuid PRIMARY KEY REFERENCES matches(id),
  result_status     text NOT NULL
                      CHECK (result_status IN ('SCHEDULED','LIVE','FT','AET','PEN','CANCELLED')),
  base_home         int,
  base_away         int,
  pen_home          int,
  pen_away          int,
  toto_home         int,
  toto_away         int,
  winner_team_id    uuid REFERENCES teams(id),
  source            text NOT NULL DEFAULT 'PROVIDER'
                      CHECK (source IN ('PROVIDER','ADMIN')),
  confirmed         boolean NOT NULL DEFAULT false,
  provider_payload  jsonb,
  updated_by        uuid REFERENCES users(id),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 5. Bets
-- ---------------------------------------------------------------------------
CREATE TABLE match_bets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id  uuid NOT NULL REFERENCES participants(id),
  match_id        uuid NOT NULL REFERENCES matches(id),
  pred_home       int  NOT NULL CHECK (pred_home  >= 0 AND pred_home  <= 99),
  pred_away       int  NOT NULL CHECK (pred_away  >= 0 AND pred_away  <= 99),
  x2              boolean NOT NULL DEFAULT false,
  pen_winner      text CHECK (pen_winner IN ('HOME','AWAY')),
  submitted_at    timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  version         int NOT NULL DEFAULT 1,
  UNIQUE (participant_id, match_id)
);
CREATE INDEX match_bets_match_idx ON match_bets (match_id);

CREATE TABLE bonus_categories (
  id                  text PRIMARY KEY,
  tournament_id       text NOT NULL REFERENCES tournaments(id),
  name_ru             text NOT NULL,
  name_en             text NOT NULL,
  item_count          int  NOT NULL,
  points_per_correct  int  NOT NULL,
  is_key_tiebreaker   boolean NOT NULL DEFAULT false,
  settles_after_stage text NOT NULL,
  item_type           text NOT NULL CHECK (item_type IN ('TEAM','PLAYER')),
  sort_order          int  NOT NULL
);

CREATE TABLE bonus_bets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id  uuid NOT NULL REFERENCES participants(id),
  category_id     text NOT NULL REFERENCES bonus_categories(id),
  submitted_at    timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  locked_at       timestamptz,
  UNIQUE (participant_id, category_id)
);

CREATE TABLE bonus_bet_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bonus_bet_id    uuid NOT NULL REFERENCES bonus_bets(id) ON DELETE CASCADE,
  team_id         uuid REFERENCES teams(id),
  player_name     text,
  position        int  NOT NULL DEFAULT 0,
  CHECK ((team_id IS NOT NULL) <> (player_name IS NOT NULL)),
  UNIQUE (bonus_bet_id, team_id)
);

CREATE TABLE bonus_outcomes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id   text NOT NULL REFERENCES bonus_categories(id),
  team_id       uuid REFERENCES teams(id),
  player_name   text,
  settled_at    timestamptz NOT NULL DEFAULT now(),
  CHECK ((team_id IS NOT NULL) <> (player_name IS NOT NULL)),
  UNIQUE (category_id, team_id)
);

-- ---------------------------------------------------------------------------
-- 6. Scoring ledger & leaderboard
-- ---------------------------------------------------------------------------
CREATE TABLE score_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id  uuid NOT NULL REFERENCES participants(id),
  source          text NOT NULL CHECK (source IN ('MATCH','BONUS')),
  unit_key        text NOT NULL,
  match_id        uuid REFERENCES matches(id),
  category_id     text REFERENCES bonus_categories(id),
  stage           text,
  points          int  NOT NULL,
  detail          jsonb,
  computed_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (participant_id, unit_key)
);
CREATE INDEX score_events_participant_idx ON score_events (participant_id);

CREATE VIEW v_standings AS
SELECT
  p.id   AS participant_id,
  p.display_name,
  COALESCE(SUM(se.points), 0)                                              AS total_points,
  COALESCE(SUM(se.points) FILTER (WHERE se.source='MATCH'), 0)             AS match_points,
  COALESCE(SUM(se.points) FILTER (WHERE se.source='BONUS'), 0)             AS bonus_points,
  COALESCE(SUM(se.points) FILTER (
    WHERE se.source='MATCH' AND se.stage IN ('R32','R16','QF','SF','THIRD','FINAL')), 0)
                                                                           AS playoff_match_points,
  COALESCE(SUM(se.points) FILTER (
    WHERE se.source='BONUS' AND se.category_id IN
      ('QF_PARTICIPANT','SF_PARTICIPANT','FINALIST','CHAMPION')), 0)       AS key_bonus_points,
  p.tiebreak_rank
FROM participants p
LEFT JOIN score_events se ON se.participant_id = p.id
WHERE p.status = 'ACTIVE'
GROUP BY p.id;

CREATE TABLE leaderboard_snapshots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id text NOT NULL REFERENCES tournaments(id),
  generated_at  timestamptz NOT NULL DEFAULT now(),
  rows          jsonb NOT NULL,
  reason        text
);
CREATE INDEX leaderboard_snapshots_idx ON leaderboard_snapshots (tournament_id, generated_at DESC);

-- ---------------------------------------------------------------------------
-- 7. Audit & integration logs
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES users(id),
  actor_kind    text NOT NULL CHECK (actor_kind IN ('USER','ADMIN','SYSTEM')),
  action        text NOT NULL,
  entity_type   text NOT NULL,
  entity_id     text,
  before        jsonb,
  after         jsonb,
  reason        text,
  ip            inet,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id, created_at DESC);

CREATE TABLE provider_sync_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        text NOT NULL,
  endpoint        text NOT NULL,
  request_params  jsonb,
  http_status     int,
  items           int,
  ok              boolean NOT NULL,
  error           text,
  quota_remaining int,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz
);

CREATE TABLE sheet_export_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode        text NOT NULL CHECK (mode IN ('FULL','AUDIT_APPEND')),
  target      text NOT NULL,
  ranges      jsonb,
  rows        int,
  ok          boolean NOT NULL,
  error       text,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Idempotency store for PUT /api/me/match-bets (architecture/06 §4).
-- Stores the response JSON keyed by (participant_id, idempotency_key) for 24h.
-- ---------------------------------------------------------------------------
CREATE TABLE idempotency_keys (
  participant_id  uuid NOT NULL REFERENCES participants(id),
  idempotency_key text NOT NULL,
  response        jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (participant_id, idempotency_key)
);
CREATE INDEX idempotency_keys_created_idx ON idempotency_keys (created_at);
