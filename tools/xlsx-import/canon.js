// Canonicalize the other site's short team names in bets.json to our full DB
// names (exact-token mapping, applied to match headers and bonus picks).
// Participant names: Артем → Артём where our roster has ё.
const fs = require("fs");

const TEAM = new Map([
  ["Юж. Корея", "Южная Корея"],
  ["Босния", "Босния и Герцеговина"],
  ["С. Аравия", "Саудовская Аравия"],
  ["Н. Зеландия", "Новая Зеландия"],
  ["Конго", "ДР Конго"], // exact token only — "ДР Конго" stays as is
]);
const NAME = new Map([
  ["Гнатенко Артем", "Гнатенко Артём"],
  ["Ковальчук Артем", "Ковальчук Артём"],
  ["Рулев Аркадий", "Рулёв Аркадий"],
]);

const t = (s) => TEAM.get(s.trim()) ?? s.trim();

const data = JSON.parse(fs.readFileSync("./bets.json", "utf8"));
let headerFixes = 0, pickFixes = 0, nameFixes = 0;
for (const p of data) {
  if (NAME.has(p.name)) { p.name = NAME.get(p.name); nameFixes++; }
  for (const m of p.main ?? []) {
    const [h, a] = m.match.split(" - ").map((s) => s.trim());
    const fixed = `${t(h)} - ${t(a)}`;
    if (fixed !== m.match) { m.match = fixed; headerFixes++; }
  }
  for (const k of Object.keys(p.bonus ?? {})) {
    if (k === "TOP_SCORER") continue;
    p.bonus[k] = p.bonus[k].map((x) => {
      const f = t(x);
      if (f !== x.trim()) pickFixes++;
      return f;
    });
  }
}
fs.writeFileSync("./bets.json", JSON.stringify(data, null, 2));
console.log({ headerFixes, pickFixes, nameFixes });
