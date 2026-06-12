// Read-only verification of the exported spreadsheet: prints the first rows of
// each tab so the new human-readable format can be eyeballed from the terminal.
// Creds come from env vars (piped from the prod .env), nothing written to disk.
import { google } from "googleapis";

async function main() {
  const credentials = JSON.parse(process.env.GOOGLE_SA_JSON!);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.SHEET_ID!;

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  console.log("tabs:", (meta.data.sheets ?? []).map((s) => s.properties?.title).join(" | "));

  const ranges = [
    "'Таблица'!A1:H4",
    "'Результаты'!A1:F3",
    "'Ставки на матчи'!A1:F3",
    "'Победители групп'!A1:E3",
    "'Бонусы'!A1:D4",
    "'Участники'!A1:D3",
  ];
  const res = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges });
  for (const vr of res.data.valueRanges ?? []) {
    console.log("\n===", vr.range, "===");
    for (const row of vr.values ?? []) console.log(row.join(" │ "));
  }
  process.exit(0);
}
main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
