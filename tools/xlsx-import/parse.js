// Parse the uploaded xlsx into a raw, reviewable bets.json.
// No DB, no normalization here — just faithful extraction. Mapping + validation
// happen later against the live DB.
const XLSX = require("xlsx");
const fs = require("fs");
const wb = XLSX.readFile(process.argv[2] || "./bets.xlsx");
const get = (n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: "" });

const main = get("основные ставки");
const bon = get("бонусные ставки");

const clean = (v) => String(v ?? "").trim();
const isNum = (v) => clean(v) !== "" && /^\d{1,2}$/.test(clean(v));

// Participant order is identical across all sheets/blocks: idx 0..22.
const NAMES = [];
for (let r = 2; r <= 24; r++) NAMES.push(clean(main[r][1]));

// --- Main bets: each match = 4 cols from col 4; [home, away, outcome, points] ---
const matchHeaders = [];
for (let c = 4; c < main[0].length; c += 4) {
  const name = clean(main[0][c]);
  if (name) matchHeaders.push({ baseCol: c, name });
}

// --- Bonus column layouts (derived from inspect2) ---
const GW_COLS = [3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36];           // block1, 12 group winners
const R16_COLS = [3, 4, 6, 7, 9, 10, 12, 13, 15, 16, 18, 19, 21, 22, 24, 25]; // block2, 16
const QF_COLS = [3, 4, 6, 7, 9, 10, 12, 13];                              // block3, 8
const SF_COLS = [15, 16, 18, 19];                                         // block3, 4
const FIN_COLS = [21, 22];                                                // block3, 2
const CHAMP_COL = 24;                                                     // block3, 1
const SCORER_COL = 25;                                                    // block3, 1
const B1 = 2, B2 = 34, B3 = 61; // first participant row of each block

const pickList = (row, cols) => cols.map((c) => clean(row[c])).filter((x) => x !== "");

// The importer indexes bonus blocks by row offset; that is only valid if every
// block lists participants in exactly the same order as the main sheet.
for (let i = 0; i < NAMES.length; i++) {
  for (const [start, label] of [[B1, "block1"], [B2, "block2"], [B3, "block3"]]) {
    const n = clean(bon[start + i][1]);
    if (n !== NAMES[i]) throw new Error(`name mismatch at ${label} row ${start + i}: "${n}" vs main "${NAMES[i]}"`);
  }
}

const out = [];
for (let i = 0; i < NAMES.length; i++) {
  const mrow = main[2 + i];
  const mainBets = [];
  for (const mh of matchHeaders) {
    const home = clean(mrow[mh.baseCol]);
    const away = clean(mrow[mh.baseCol + 1]);
    if (isNum(home) && isNum(away)) mainBets.push({ match: mh.name, home: +home, away: +away });
  }
  const b1 = bon[B1 + i], b2 = bon[B2 + i], b3 = bon[B3 + i];
  out.push({
    idx: i,
    sheetNo: clean(mrow[0]),
    name: NAMES[i],
    main: mainBets,
    bonus: {
      GROUP_WINNER: pickList(b1, GW_COLS),
      R16_PARTICIPANT: pickList(b2, R16_COLS),
      QF_PARTICIPANT: pickList(b3, QF_COLS),
      SF_PARTICIPANT: pickList(b3, SF_COLS),
      FINALIST: pickList(b3, FIN_COLS),
      CHAMPION: pickList(b3, [CHAMP_COL]),
      TOP_SCORER: pickList(b3, [SCORER_COL]),
    },
  });
}

fs.writeFileSync("bets.json", JSON.stringify(out, null, 2));

// --- Summary ---
console.log("name | main | GW R16 QF SF FIN CH TS");
for (const p of out) {
  const b = p.bonus;
  console.log(
    `${p.name.padEnd(24)} | ${String(p.main.length).padStart(2)} | ` +
    `${b.GROUP_WINNER.length} ${b.R16_PARTICIPANT.length} ${b.QF_PARTICIPANT.length} ${b.SF_PARTICIPANT.length} ${b.FINALIST.length} ${b.CHAMPION.length} ${b.TOP_SCORER.length}`,
  );
}
const anyMain = out.filter((p) => p.main.length).length;
const anyBonus = out.filter((p) => Object.values(p.bonus).some((a) => a.length)).length;
console.log(`\n${out.length} people | ${anyMain} have main bets | ${anyBonus} have any bonus`);
console.log("Unique team strings across bonuses + match headers:");
const teamStrings = new Set();
for (const mh of matchHeaders) mh.name.split(" - ").forEach((t) => teamStrings.add(t.trim()));
for (const p of out) for (const k of ["GROUP_WINNER","R16_PARTICIPANT","QF_PARTICIPANT","SF_PARTICIPANT","FINALIST","CHAMPION"]) p.bonus[k].forEach((t) => teamStrings.add(t));
console.log([...teamStrings].sort().join(", "));
console.log("\nTop-scorer values:", [...new Set(out.flatMap((p) => p.bonus.TOP_SCORER))].join(" | "));
