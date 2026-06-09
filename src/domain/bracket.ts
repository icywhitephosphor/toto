// The fixed knockout bracket (matches 73–104), verbatim from architecture/03 §4.
// Slot strings follow the 04 §4 convention:
//   'W-A'  = winner of group A      'RU-B' = runner-up of group B
//   '3RD:A/B/C/D/F' = a 3rd-placed team from one of these groups (Annex C)
//   'W73'  = winner of match 73     'L101' = loser of match 101
// Teams resolve later (provider import + admin confirm); until then kickoff_at
// and deadline_at are NULL and the match is not open for bets (11 §2.3).

import type { Stage } from "@/scoring";

export interface KnockoutSlot {
  fifaMatchNo: number;
  stage: Stage;
  homeSlot: string;
  awaySlot: string;
}

export const KNOCKOUT_MATCHES: KnockoutSlot[] = [
  // Round of 32 (R32, 73–88)
  { fifaMatchNo: 73, stage: "R32", homeSlot: "RU-A", awaySlot: "RU-B" },
  { fifaMatchNo: 74, stage: "R32", homeSlot: "W-E", awaySlot: "3RD:A/B/C/D/F" },
  { fifaMatchNo: 75, stage: "R32", homeSlot: "W-F", awaySlot: "RU-C" },
  { fifaMatchNo: 76, stage: "R32", homeSlot: "W-C", awaySlot: "RU-F" },
  { fifaMatchNo: 77, stage: "R32", homeSlot: "W-I", awaySlot: "3RD:C/D/F/G/H" },
  { fifaMatchNo: 78, stage: "R32", homeSlot: "RU-E", awaySlot: "RU-I" },
  { fifaMatchNo: 79, stage: "R32", homeSlot: "W-A", awaySlot: "3RD:C/E/F/H/I" },
  { fifaMatchNo: 80, stage: "R32", homeSlot: "W-L", awaySlot: "3RD:E/H/I/J/K" },
  { fifaMatchNo: 81, stage: "R32", homeSlot: "W-D", awaySlot: "3RD:B/E/F/I/J" },
  { fifaMatchNo: 82, stage: "R32", homeSlot: "W-G", awaySlot: "3RD:A/E/H/I/J" },
  { fifaMatchNo: 83, stage: "R32", homeSlot: "RU-K", awaySlot: "RU-L" },
  { fifaMatchNo: 84, stage: "R32", homeSlot: "W-H", awaySlot: "RU-J" },
  { fifaMatchNo: 85, stage: "R32", homeSlot: "W-B", awaySlot: "3RD:E/F/G/I/J" },
  { fifaMatchNo: 86, stage: "R32", homeSlot: "W-J", awaySlot: "RU-H" },
  { fifaMatchNo: 87, stage: "R32", homeSlot: "W-K", awaySlot: "3RD:D/E/I/J/L" },
  { fifaMatchNo: 88, stage: "R32", homeSlot: "RU-D", awaySlot: "RU-G" },
  // Round of 16 (R16, 89–96)
  { fifaMatchNo: 89, stage: "R16", homeSlot: "W74", awaySlot: "W77" },
  { fifaMatchNo: 90, stage: "R16", homeSlot: "W73", awaySlot: "W75" },
  { fifaMatchNo: 91, stage: "R16", homeSlot: "W76", awaySlot: "W78" },
  { fifaMatchNo: 92, stage: "R16", homeSlot: "W79", awaySlot: "W80" },
  { fifaMatchNo: 93, stage: "R16", homeSlot: "W83", awaySlot: "W84" },
  { fifaMatchNo: 94, stage: "R16", homeSlot: "W81", awaySlot: "W82" },
  { fifaMatchNo: 95, stage: "R16", homeSlot: "W86", awaySlot: "W88" },
  { fifaMatchNo: 96, stage: "R16", homeSlot: "W85", awaySlot: "W87" },
  // Quarter-finals (QF, 97–100)
  { fifaMatchNo: 97, stage: "QF", homeSlot: "W89", awaySlot: "W90" },
  { fifaMatchNo: 98, stage: "QF", homeSlot: "W93", awaySlot: "W94" },
  { fifaMatchNo: 99, stage: "QF", homeSlot: "W91", awaySlot: "W92" },
  { fifaMatchNo: 100, stage: "QF", homeSlot: "W95", awaySlot: "W96" },
  // Semi-finals (SF, 101–102)
  { fifaMatchNo: 101, stage: "SF", homeSlot: "W97", awaySlot: "W98" },
  { fifaMatchNo: 102, stage: "SF", homeSlot: "W99", awaySlot: "W100" },
  // Third-place play-off (THIRD, 103) and Final (FINAL, 104)
  { fifaMatchNo: 103, stage: "THIRD", homeSlot: "L101", awaySlot: "L102" },
  { fifaMatchNo: 104, stage: "FINAL", homeSlot: "W101", awaySlot: "W102" },
];
