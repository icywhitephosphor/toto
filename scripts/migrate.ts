// Minimal forward-only SQL migration runner. Applies every migrations/*.sql
// file (lexicographic order) that has not been applied yet, each in one
// transaction, and records it in schema_migrations. Hand-written SQL keeps the
// DB identical to architecture/04 (CHECK constraints, composite FK, the view).
import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";

// Resolve relative to the working directory (repo root locally, /app in Docker),
// so this works both under tsx and as a bundled CJS file. Override with MIGRATIONS_DIR.
const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR ?? join(process.cwd(), "migrations");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const sql = postgres(url, { max: 1, onnotice: () => {} });

  try {
    await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`;

    const applied = new Set(
      (await sql`SELECT filename FROM schema_migrations`).map((r) => r.filename as string),
    );

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith(".sql"))
      .sort();

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const text = await readFile(join(MIGRATIONS_DIR, file), "utf8");
      process.stdout.write(`Applying ${file} ... `);
      await sql.unsafe(`BEGIN;\n${text}\nCOMMIT;`).simple();
      await sql`INSERT INTO schema_migrations (filename) VALUES (${file})`;
      process.stdout.write("done\n");
      count++;
    }

    console.log(count === 0 ? "No pending migrations." : `Applied ${count} migration(s).`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
