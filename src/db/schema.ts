// Drizzle table definitions for type-safe queries. The authoritative DDL is the
// hand-written SQL in migrations/0001_init.sql (verbatim from architecture/04);
// this file mirrors it for the query builder. Keep the two in sync.
import {
  pgTable,
  uuid,
  text,
  bigint,
  boolean,
  integer,
  timestamp,
  jsonb,
  interval,
  inet,
  primaryKey,
  unique,
  index,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  telegramId: bigint("telegram_id", { mode: "number" }).notNull().unique(),
  username: text("username"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  photoUrl: text("photo_url"),
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

export const participants = pgTable("participants", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").unique().references(() => users.id),
  rosterNo: integer("roster_no").notNull().unique(),
  displayName: text("display_name").notNull().unique(),
  status: text("status").notNull().default("ACTIVE"),
  tiebreakRank: integer("tiebreak_rank"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tournaments = pgTable("tournaments", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  displayTz: text("display_tz").notNull().default("Europe/Moscow"),
  bonusDeadlineAt: timestamp("bonus_deadline_at", { withTimezone: true }).notNull(),
  matchDeadlineLead: interval("match_deadline_lead").notNull().default("3 hours"),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
});

export const groups = pgTable(
  "groups",
  {
    tournamentId: text("tournament_id").notNull().references(() => tournaments.id),
    code: text("code").notNull(),
    name: text("name"),
  },
  (t) => [primaryKey({ columns: [t.tournamentId, t.code] })],
);

export const teams = pgTable(
  "teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tournamentId: text("tournament_id").notNull().references(() => tournaments.id),
    groupCode: text("group_code").notNull(),
    code: text("code").notNull(),
    nameRu: text("name_ru").notNull(),
    nameEn: text("name_en").notNull(),
    fifaCode: text("fifa_code"),
    providerTeamId: text("provider_team_id"),
    logoUrl: text("logo_url"),
  },
  (t) => [
    unique().on(t.tournamentId, t.code),
    index("teams_group_idx").on(t.tournamentId, t.groupCode),
    index("teams_provider_idx").on(t.providerTeamId),
  ],
);

export const matches = pgTable(
  "matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tournamentId: text("tournament_id").notNull().references(() => tournaments.id),
    fifaMatchNo: integer("fifa_match_no").notNull(),
    stage: text("stage").notNull(),
    groupCode: text("group_code"),
    homeTeamId: uuid("home_team_id").references(() => teams.id),
    awayTeamId: uuid("away_team_id").references(() => teams.id),
    homeSlot: text("home_slot"),
    awaySlot: text("away_slot"),
    kickoffAt: timestamp("kickoff_at", { withTimezone: true }),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }),
    venue: text("venue"),
    city: text("city"),
    status: text("status").notNull().default("SCHEDULED"),
    x2Allowed: boolean("x2_allowed").notNull().default(false),
    providerMatchId: text("provider_match_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.tournamentId, t.fifaMatchNo),
    index("matches_stage_idx").on(t.stage),
    index("matches_kickoff_idx").on(t.kickoffAt),
    index("matches_deadline_idx").on(t.deadlineAt),
    index("matches_status_idx").on(t.status),
  ],
);

export const matchResults = pgTable("match_results", {
  matchId: uuid("match_id").primaryKey().references(() => matches.id),
  resultStatus: text("result_status").notNull(),
  baseHome: integer("base_home"),
  baseAway: integer("base_away"),
  penHome: integer("pen_home"),
  penAway: integer("pen_away"),
  totoHome: integer("toto_home"),
  totoAway: integer("toto_away"),
  winnerTeamId: uuid("winner_team_id").references(() => teams.id),
  source: text("source").notNull().default("PROVIDER"),
  confirmed: boolean("confirmed").notNull().default(false),
  providerPayload: jsonb("provider_payload"),
  updatedBy: uuid("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const matchBets = pgTable(
  "match_bets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    participantId: uuid("participant_id").notNull().references(() => participants.id),
    matchId: uuid("match_id").notNull().references(() => matches.id),
    predHome: integer("pred_home").notNull(),
    predAway: integer("pred_away").notNull(),
    x2: boolean("x2").notNull().default(false),
    penWinner: text("pen_winner"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    unique().on(t.participantId, t.matchId),
    index("match_bets_match_idx").on(t.matchId),
  ],
);

export const bonusCategories = pgTable("bonus_categories", {
  id: text("id").primaryKey(),
  tournamentId: text("tournament_id").notNull().references(() => tournaments.id),
  nameRu: text("name_ru").notNull(),
  nameEn: text("name_en").notNull(),
  itemCount: integer("item_count").notNull(),
  pointsPerCorrect: integer("points_per_correct").notNull(),
  isKeyTiebreaker: boolean("is_key_tiebreaker").notNull().default(false),
  settlesAfterStage: text("settles_after_stage").notNull(),
  itemType: text("item_type").notNull(),
  sortOrder: integer("sort_order").notNull(),
});

export const bonusBets = pgTable(
  "bonus_bets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    participantId: uuid("participant_id").notNull().references(() => participants.id),
    categoryId: text("category_id").notNull().references(() => bonusCategories.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
  },
  (t) => [unique().on(t.participantId, t.categoryId)],
);

export const bonusBetItems = pgTable(
  "bonus_bet_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bonusBetId: uuid("bonus_bet_id").notNull().references(() => bonusBets.id, { onDelete: "cascade" }),
    teamId: uuid("team_id").references(() => teams.id),
    playerName: text("player_name"),
    position: integer("position").notNull().default(0),
  },
  (t) => [unique().on(t.bonusBetId, t.teamId)],
);

export const bonusOutcomes = pgTable(
  "bonus_outcomes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    categoryId: text("category_id").notNull().references(() => bonusCategories.id),
    teamId: uuid("team_id").references(() => teams.id),
    playerName: text("player_name"),
    settledAt: timestamp("settled_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.categoryId, t.teamId)],
);

export const scoreEvents = pgTable(
  "score_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    participantId: uuid("participant_id").notNull().references(() => participants.id),
    source: text("source").notNull(),
    unitKey: text("unit_key").notNull(),
    matchId: uuid("match_id").references(() => matches.id),
    categoryId: text("category_id").references(() => bonusCategories.id),
    stage: text("stage"),
    points: integer("points").notNull(),
    detail: jsonb("detail"),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.participantId, t.unitKey),
    index("score_events_participant_idx").on(t.participantId),
  ],
);

export const leaderboardSnapshots = pgTable(
  "leaderboard_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tournamentId: text("tournament_id").notNull().references(() => tournaments.id),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    rows: jsonb("rows").notNull(),
    reason: text("reason"),
  },
  (t) => [index("leaderboard_snapshots_idx").on(t.tournamentId, t.generatedAt)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    actorKind: text("actor_kind").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    reason: text("reason"),
    ip: inet("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_log_entity_idx").on(t.entityType, t.entityId, t.createdAt)],
);

export const providerSyncLog = pgTable("provider_sync_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull(),
  endpoint: text("endpoint").notNull(),
  requestParams: jsonb("request_params"),
  httpStatus: integer("http_status"),
  items: integer("items"),
  ok: boolean("ok").notNull(),
  error: text("error"),
  quotaRemaining: integer("quota_remaining"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const sheetExportLog = pgTable("sheet_export_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  mode: text("mode").notNull(),
  target: text("target").notNull(),
  ranges: jsonb("ranges"),
  rows: integer("rows"),
  ok: boolean("ok").notNull(),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    participantId: uuid("participant_id").notNull().references(() => participants.id),
    idempotencyKey: text("idempotency_key").notNull(),
    response: jsonb("response").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.participantId, t.idempotencyKey] }),
    index("idempotency_keys_created_idx").on(t.createdAt),
  ],
);
