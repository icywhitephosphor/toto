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

// Official knockout kickoffs (matches 73–104, FIFA calendar as published after
// the December 2025 draw; transcribed from the МСК wall chart and stored in
// UTC). Venue/city only where reliably known — display data, never scoring.
// Betting deadlines for these matches stay NULL until the pairing resolves
// (11 §2.3); kickoff here only drives the calendar/bracket display.
export interface KnockoutKickoff {
  kickoffAt: Date;
  venue?: string;
  city?: string;
}

const ko = (m: number, d: number, h: number, min = 0) =>
  new Date(Date.UTC(2026, m - 1, d, h, min));

export const KNOCKOUT_KICKOFFS: Record<number, KnockoutKickoff> = {
  73: { kickoffAt: ko(6, 28, 19), venue: "SoFi Stadium", city: "Лос-Анджелес" },
  74: { kickoffAt: ko(6, 29, 20, 30), venue: "Gillette Stadium", city: "Бостон" },
  75: { kickoffAt: ko(6, 30, 1), venue: "Estadio BBVA", city: "Монтеррей" },
  76: { kickoffAt: ko(6, 29, 17) },
  77: { kickoffAt: ko(6, 30, 21), venue: "MetLife Stadium", city: "Нью-Йорк" },
  78: { kickoffAt: ko(6, 30, 17) },
  79: { kickoffAt: ko(7, 1, 1) },
  80: { kickoffAt: ko(7, 1, 16) },
  81: { kickoffAt: ko(7, 2, 0) },
  82: { kickoffAt: ko(7, 1, 20) },
  83: { kickoffAt: ko(7, 2, 23), venue: "BMO Field", city: "Торонто" },
  84: { kickoffAt: ko(7, 2, 19), venue: "SoFi Stadium", city: "Лос-Анджелес" },
  85: { kickoffAt: ko(7, 3, 3) },
  86: { kickoffAt: ko(7, 3, 22) },
  87: { kickoffAt: ko(7, 4, 1, 30) },
  88: { kickoffAt: ko(7, 3, 18) },
  89: { kickoffAt: ko(7, 4, 21) },
  90: { kickoffAt: ko(7, 4, 17) },
  91: { kickoffAt: ko(7, 5, 20) },
  92: { kickoffAt: ko(7, 6, 0) },
  93: { kickoffAt: ko(7, 6, 19) },
  94: { kickoffAt: ko(7, 7, 0) },
  95: { kickoffAt: ko(7, 7, 16) },
  96: { kickoffAt: ko(7, 7, 20) },
  97: { kickoffAt: ko(7, 9, 20) },
  98: { kickoffAt: ko(7, 10, 19) },
  99: { kickoffAt: ko(7, 11, 21) },
  100: { kickoffAt: ko(7, 12, 1) },
  101: { kickoffAt: ko(7, 14, 19), venue: "AT&T Stadium", city: "Даллас" },
  102: { kickoffAt: ko(7, 15, 19), venue: "Mercedes-Benz Stadium", city: "Атланта" },
  103: { kickoffAt: ko(7, 18, 21), venue: "Hard Rock Stadium", city: "Майами" },
  104: { kickoffAt: ko(7, 19, 19), venue: "MetLife Stadium", city: "Нью-Йорк" },
};

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
