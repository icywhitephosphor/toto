// drizzle-kit config — used only for `drizzle-kit studio` (DB browsing) and
// introspection. Migrations themselves are the hand-written SQL in migrations/
// (applied by scripts/migrate.ts), so the DB matches architecture/04 exactly.
import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
