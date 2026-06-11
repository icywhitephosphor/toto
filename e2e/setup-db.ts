// Pre-step for E2E: create (if needed), migrate and seed the isolated toto_e2e
// database BEFORE Playwright starts the web server (whose /api/health probe needs
// the DB to exist). Run via the `e2e` npm script, ahead of `playwright test`.
import { execSync } from "node:child_process";
import postgres from "postgres";
import { ADMIN_DB_URL, E2E_DATABASE_URL } from "./config";

async function main() {
  const admin = postgres(ADMIN_DB_URL, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe("CREATE DATABASE toto_e2e");
    console.log("[e2e] created database toto_e2e");
  } catch {
    console.log("[e2e] database toto_e2e already exists");
  } finally {
    await admin.end();
  }

  const env = { ...process.env, DATABASE_URL: E2E_DATABASE_URL };
  execSync("tsx scripts/migrate.ts", { stdio: "inherit", env });
  execSync("tsx scripts/seed.ts", { stdio: "inherit", env });

  // The seed uses the real 2026 calendar, so once the tournament is underway
  // the early deadlines are in the past and bet/bonus tests start failing for
  // time reasons, not bugs. Shift the whole schedule so match #1 kicks off
  // tomorrow and the bonus deadline is open — e2e DB only.
  const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    await sql
      .unsafe(
        `WITH off AS (
           SELECT (now() + interval '1 day') - min(kickoff_at) AS d
           FROM matches WHERE kickoff_at IS NOT NULL
         )
         UPDATE matches
         SET kickoff_at = kickoff_at + (SELECT d FROM off),
             deadline_at = deadline_at + (SELECT d FROM off)
         WHERE kickoff_at IS NOT NULL;
         UPDATE tournaments SET bonus_deadline_at = now() + interval '12 hours';`,
      )
      .simple();
    console.log("[e2e] schedule shifted: match #1 kicks off in ~24h, bonuses open");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("[e2e] setup-db failed:", err);
  process.exit(1);
});
