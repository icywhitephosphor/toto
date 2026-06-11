// Colour class for earned points — one visual language everywhere:
//   exact + ×2  → glowing gold (the jackpot)
//   exact       → gold
//   positive    → green
//   zero        → faint grey
//   negative    → hard red (a missed ×2)
export function pointsClass(points: number, opts?: { exact?: boolean; x2?: boolean }): string {
  if (points < 0) return "pts-neg";
  if (opts?.exact && opts?.x2) return "pts-exact-x2";
  if (opts?.exact && points > 0) return "pts-exact";
  if (points > 0) return "pts-pos";
  return "pts-zero";
}

export const fmtPts = (n: number): string => (n > 0 ? `+${n}` : String(n));
