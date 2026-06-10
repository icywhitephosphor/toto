// Server-only environment access. Lazy getters so `next build` (which imports
// route modules) never throws on a missing runtime secret. Never import this
// from a "use client" module — these values must not reach the browser bundle.
// (No `server-only` import: this module is also loaded by the node-cron worker
// and the migrate/seed scripts, which run under tsx, not the Next bundler.)

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

function optional(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

export const env = {
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  get jwtSecret() {
    return required("JWT_SECRET");
  },
  get botToken() {
    return required("BOT_TOKEN");
  },
  get botUsername() {
    return optional("BOT_USERNAME") ?? "toto_wc2026_bot";
  },
  get adminTelegramId() {
    const v = optional("ADMIN_TELEGRAM_ID");
    return v ? Number(v) : undefined;
  },
  // Additional admins by Telegram username (CSV, case-insensitive, @ optional).
  // Username comes from verified initData/widget payload, so it is trustworthy;
  // useful when an admin's numeric id isn't known until their first login.
  get adminUsernames(): Set<string> {
    const v = optional("ADMIN_TG_USERNAMES");
    if (!v) return new Set();
    return new Set(
      v.split(",").map((s) => s.trim().replace(/^@/, "").toLowerCase()).filter((s) => s.length > 0),
    );
  },
  get fdToken() {
    return optional("FD_TOKEN");
  },
  get googleSaJson() {
    return optional("GOOGLE_SA_JSON");
  },
  get sheetId() {
    return optional("SHEET_ID");
  },
  // Replay window for Telegram auth_date freshness (07 §3.2). 1h default.
  get authReplayWindowSeconds() {
    const v = optional("AUTH_REPLAY_WINDOW_SECONDS");
    return v ? Number(v) : 60 * 60;
  },
  get isProduction() {
    return process.env.NODE_ENV === "production";
  },
};

export const TOURNAMENT_ID = "wc2026";
