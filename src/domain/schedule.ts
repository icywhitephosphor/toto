// Deterministic group-stage fixtures (matches 1–72). Each group plays a full
// round-robin (C(4,2)=6 games → 6×12=72). Numbering is matchday-major, then
// group-major, so match 1 = Group A pos1 vs pos2 = Mexico vs South Africa — the
// verified opening match (00 §3). Kickoff times are seed approximations spread
// across the real group-stage window (11–27 Jun 2026); the admin "import
// fixtures" flow later refreshes exact times/venues from the provider (08).

import { GROUP_CODES, TEAMS, type GroupCode } from "./teams";

export interface SeedGroupMatch {
  fifaMatchNo: number;
  groupCode: GroupCode;
  homeCode: string;
  awayCode: string;
  kickoffAt: Date;
  venue: string;
  city: string;
}

// Real WC-2026 host venues. Index 0 (Estadio Azteca) hosts the opener.
const VENUES: Array<{ venue: string; city: string }> = [
  { venue: "Estadio Azteca", city: "Мехико" },
  { venue: "Estadio Akron", city: "Гвадалахара" },
  { venue: "Estadio BBVA", city: "Монтеррей" },
  { venue: "Mercedes-Benz Stadium", city: "Атланта" },
  { venue: "Gillette Stadium", city: "Бостон" },
  { venue: "AT&T Stadium", city: "Даллас" },
  { venue: "NRG Stadium", city: "Хьюстон" },
  { venue: "Arrowhead Stadium", city: "Канзас-Сити" },
  { venue: "SoFi Stadium", city: "Лос-Анджелес" },
  { venue: "Hard Rock Stadium", city: "Майами" },
  { venue: "MetLife Stadium", city: "Нью-Йорк" },
  { venue: "Lincoln Financial Field", city: "Филадельфия" },
  { venue: "Levi's Stadium", city: "Сан-Франциско" },
  { venue: "Lumen Field", city: "Сиэтл" },
  { venue: "BMO Field", city: "Торонто" },
  { venue: "BC Place", city: "Ванкувер" },
];

// Pairings per matchday given draw positions 1..4. Home team is listed first.
const MATCHDAY_PAIRS: Array<Array<[number, number]>> = [
  [[1, 2], [3, 4]], // matchday 1
  [[1, 3], [2, 4]], // matchday 2
  [[1, 4], [2, 3]], // matchday 3
];

// First UTC midnight of each matchday window.
const MATCHDAY_WINDOW_START = [
  Date.UTC(2026, 5, 11), // 11 Jun
  Date.UTC(2026, 5, 17), // 17 Jun
  Date.UTC(2026, 5, 24), // 24 Jun
];

const SLOTS_PER_DAY = 6;
const BASE_HOUR = 16; // first kickoff at 16:00 UTC (19:00 MSK)
const SLOT_GAP_HOURS = 2;

function teamCode(group: GroupCode, pos: number): string {
  const t = TEAMS.find((x) => x.groupCode === group && x.pos === pos);
  if (!t) throw new Error(`No team for group ${group} pos ${pos}`);
  return t.code;
}

export function buildGroupSchedule(): SeedGroupMatch[] {
  const out: SeedGroupMatch[] = [];
  let matchNo = 0;

  for (let md = 0; md < MATCHDAY_PAIRS.length; md++) {
    let indexInWindow = 0;
    for (const group of GROUP_CODES) {
      for (const [homePos, awayPos] of MATCHDAY_PAIRS[md]) {
        matchNo++;
        const dayOffset = Math.floor(indexInWindow / SLOTS_PER_DAY);
        const slot = indexInWindow % SLOTS_PER_DAY;
        const kickoffMs =
          MATCHDAY_WINDOW_START[md] +
          dayOffset * 24 * 3600_000 +
          (BASE_HOUR + slot * SLOT_GAP_HOURS) * 3600_000;
        const v = VENUES[(matchNo - 1) % VENUES.length];
        out.push({
          fifaMatchNo: matchNo,
          groupCode: group,
          homeCode: teamCode(group, homePos),
          awayCode: teamCode(group, awayPos),
          kickoffAt: new Date(kickoffMs),
          venue: v.venue,
          city: v.city,
        });
        indexInWindow++;
      }
    }
  }

  return out;
}
