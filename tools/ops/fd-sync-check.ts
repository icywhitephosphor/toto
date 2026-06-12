// One-off local harness: run a football-data sync pass against the local dev
// DB and print what changed. Usage:
//   FD_TOKEN=... npx tsx tmp/test-fd-sync.ts
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { matches } from "@/db/schema";
import { syncFootballData } from "@/lib/provider/sync";

async function main() {
  const out = await syncFootballData((m) => console.log("[sync]", m));
  console.log("outcome:", out);

  const [m1] = await db.select({
    no: matches.fifaMatchNo,
    kickoff: matches.kickoffAt,
    deadline: matches.deadlineAt,
    provider: matches.providerMatchId,
  }).from(matches).where(eq(matches.fifaMatchNo, 1));
  console.log("match #1 after sync:", m1);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
