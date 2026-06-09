// Always-on worker (02 §6, 13). Phase 1 responsibilities:
//   • scheduled Google Sheets full-refresh every 10 min (safety net; 09 §5.1),
//     only when SHEET_ID + GOOGLE_SA_JSON are configured.
// Phase 2 will add football-data.org polling + auto results + bonus settlement.
// dotenv MUST load before any module that reads env (the db pool reads it at
// import). Bundled for production via `npm run build:worker` → dist/worker.cjs.
import "dotenv/config";
import cron from "node-cron";
import { env } from "@/lib/env";
import { runSheetsExport } from "@/lib/sheets";

function log(msg: string) {
  console.log(`[worker ${new Date().toISOString()}] ${msg}`);
}

const sheetsConfigured = env.googleSaJson != null && env.sheetId != null;
const feedConfigured = env.fdToken != null;

log(`starting. sheets=${sheetsConfigured ? "on" : "off"} feed=${feedConfigured ? "on" : "off (Phase 2)"}`);

if (sheetsConfigured) {
  // Every 10 minutes: idempotent full refresh of the private sheet.
  cron.schedule("*/10 * * * *", async () => {
    try {
      const r = await runSheetsExport("FULL");
      log(`sheets export ok: ${r.rowsWritten} rows`);
    } catch (err) {
      log(`sheets export FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}

// Phase 2 placeholder — football-data.org polling during live windows.
if (feedConfigured) {
  log("feed token present; provider polling lands in Phase 2 (see architecture/08).");
}

// Keep the process alive even if no cron jobs were scheduled.
setInterval(() => {}, 1 << 30);

process.on("SIGTERM", () => {
  log("SIGTERM received, shutting down.");
  process.exit(0);
});
process.on("SIGINT", () => process.exit(0));
