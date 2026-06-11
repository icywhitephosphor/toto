// One-off import of bets.json into the TOTO prod DB.
// Policy (per user): additive — never delete/overwrite. New (participant,match)
// and (participant,category) rows are inserted; anything already present is left
// untouched (ON CONFLICT DO NOTHING). Adds the two missing participants.
// Run with --dry-run first to validate + preview. DATABASE_URL from env.
import postgres from "postgres";
import { readFileSync } from "node:fs";

const DRY = process.argv.includes("--dry-run");
const FILE = process.env.IMPORT_FILE || "./bets.json";
const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });

const NEW_PARTICIPANTS = [
  { name: "Иванов Михаил", roster: 22 },
  { name: "Рулёв Аркадий", roster: 23 },
];
const CAT_TYPE: Record<string, "TEAM" | "PLAYER"> = {
  GROUP_WINNER: "TEAM", R16_PARTICIPANT: "TEAM", QF_PARTICIPANT: "TEAM",
  SF_PARTICIPANT: "TEAM", FINALIST: "TEAM", CHAMPION: "TEAM", TOP_SCORER: "PLAYER",
};

// The xlsx has been normalized to the exact DB names (full country names, ё in
// participant names) — match strictly, no aliasing. Validation fails loudly on
// any residual mismatch.
const norm = (s: string) => s.trim().replace(/\s+/g, " ");

async function main() {
  const data: any[] = JSON.parse(readFileSync(FILE, "utf8"));

  // 1) ensure the two new participants
  for (const np of NEW_PARTICIPANTS) {
    const ex = await sql`SELECT id FROM participants WHERE display_name = ${np.name}`;
    if (ex.length === 0) {
      if (DRY) console.log(`[dry] CREATE participant ${np.name} (roster ${np.roster})`);
      else { await sql`INSERT INTO participants (display_name, roster_no, status) VALUES (${np.name}, ${np.roster}, 'ACTIVE')`; console.log(`created participant ${np.name}`); }
    } else console.log(`participant exists: ${np.name}`);
  }

  // 2) reference maps
  const parts = await sql`SELECT id, display_name FROM participants`;
  const partByNorm = new Map<string, string | null>(parts.map((p: any) => [norm(p.display_name), p.id]));
  for (const np of NEW_PARTICIPANTS) if (!partByNorm.has(norm(np.name))) partByNorm.set(norm(np.name), null); // null = will-exist (dry)

  const teams = await sql`SELECT id, name_ru FROM teams`;
  const teamByName = new Map<string, string>(teams.map((t: any) => [norm(t.name_ru), t.id]));
  const resolveTeam = (raw: string) => teamByName.get(norm(raw));

  const matches = await sql`
    SELECT m.id, m.fifa_match_no, h.name_ru AS home, a.name_ru AS away
    FROM matches m LEFT JOIN teams h ON h.id=m.home_team_id LEFT JOIN teams a ON a.id=m.away_team_id`;
  const matchByPair = new Map<string, string>(
    matches.filter((m: any) => m.home && m.away).map((m: any) => [`${norm(m.home)}|${norm(m.away)}`, m.id]),
  );
  const resolveMatch = (header: string) => {
    const [h, a] = header.split(" - ").map((s) => norm(s));
    return matchByPair.get(`${h}|${a}`);
  };

  const cats = new Set((await sql`SELECT id FROM bonus_categories`).map((c: any) => c.id));

  // 3) preload existing keys (for additive skip + accurate dry-run counts)
  const exMatch = new Set((await sql`SELECT participant_id, match_id FROM match_bets`).map((r: any) => `${r.participant_id}|${r.match_id}`));
  const exBonus = new Set((await sql`SELECT participant_id, category_id FROM bonus_bets`).map((r: any) => `${r.participant_id}|${r.category_id}`));

  // 4) validate everything
  const errors: string[] = [];
  for (const p of data) {
    if (!partByNorm.has(norm(p.name))) errors.push(`participant not found: ${p.name}`);
    for (const mb of p.main) if (!resolveMatch(mb.match)) errors.push(`match not found: "${mb.match}" (${p.name})`);
    for (const [cat, picks] of Object.entries<string[]>(p.bonus)) {
      if (picks.length === 0) continue;
      if (!cats.has(cat)) { errors.push(`unknown category ${cat}`); continue; }
      if (CAT_TYPE[cat] === "TEAM") {
        const seen = new Set<string>();
        for (const t of picks) {
          const id = resolveTeam(t);
          if (!id) errors.push(`team not found: "${t}" (${p.name}/${cat})`);
          else if (seen.has(id)) errors.push(`duplicate team "${t}" in ${p.name}/${cat}`);
          else seen.add(id);
        }
      }
    }
  }
  if (errors.length) { console.log("VALIDATION ERRORS:\n" + errors.join("\n")); await sql.end(); process.exit(1); }
  console.log(`validation OK (${data.length} people)`);

  // 5) import
  let mIns = 0, mSkip = 0, bIns = 0, bSkip = 0, iIns = 0;
  for (const p of data) {
    const pid = partByNorm.get(norm(p.name)) ?? null;

    for (const mb of p.main) {
      const mid = resolveMatch(mb.match)!;
      const exists = pid && exMatch.has(`${pid}|${mid}`);
      if (exists) { mSkip++; continue; }
      if (DRY) { mIns++; continue; }
      const r = await sql`INSERT INTO match_bets (participant_id, match_id, pred_home, pred_away, x2)
                          VALUES (${pid}, ${mid}, ${mb.home}, ${mb.away}, false)
                          ON CONFLICT (participant_id, match_id) DO NOTHING RETURNING id`;
      if (r.length) mIns++; else mSkip++;
    }

    for (const [cat, picks] of Object.entries<string[]>(p.bonus)) {
      if (picks.length === 0) continue;
      const existed = pid && exBonus.has(`${pid}|${cat}`);
      if (existed) { bSkip++; continue; } // additive: keep what's there, don't touch items
      if (DRY) { bIns++; iIns += picks.length; continue; }
      const br = await sql`INSERT INTO bonus_bets (participant_id, category_id) VALUES (${pid}, ${cat})
                           ON CONFLICT (participant_id, category_id) DO NOTHING RETURNING id`;
      if (!br.length) { bSkip++; continue; }
      const betId = br[0].id;
      bIns++;
      let pos = 0;
      for (const pick of picks) {
        if (CAT_TYPE[cat] === "TEAM") await sql`INSERT INTO bonus_bet_items (bonus_bet_id, team_id, position) VALUES (${betId}, ${resolveTeam(pick)!}, ${pos})`;
        else await sql`INSERT INTO bonus_bet_items (bonus_bet_id, player_name, position) VALUES (${betId}, ${pick.trim()}, ${pos})`;
        pos++; iIns++;
      }
    }
  }

  console.log(`${DRY ? "[DRY-RUN] " : ""}match_bets +${mIns} (skip existing ${mSkip}) | bonus_bets +${bIns} (skip existing ${bSkip}) | bonus_items +${iIns}`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
