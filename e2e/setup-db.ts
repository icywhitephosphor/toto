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
}

main().catch((err) => {
  console.error("[e2e] setup-db failed:", err);
  process.exit(1);
});
