// Prize pool for the top 5 places (FR-17). Money is handled offline (01 §7.5
// default); the app only *shows* the amounts. Pool is 23×2000 ₽ = 46 000 ₽;
// the current split (organizer-set, 2026-06-11) sums to 44 000 ₽ — the rest is
// the organizer's reserve. Tune these numbers in one place.
export interface Prize {
  place: number;
  amount: number; // RUB
  label: string;
}

export const PRIZE_POOL = 46_000; // RUB

export const PRIZES: Prize[] = [
  { place: 1, amount: 19000, label: "1 место" },
  { place: 2, amount: 11000, label: "2 место" },
  { place: 3, amount: 8000, label: "3 место" },
  { place: 4, amount: 4000, label: "4 место" },
  { place: 5, amount: 2000, label: "5 место" },
];

export function prizeForPlace(place: number): Prize | null {
  return PRIZES.find((p) => p.place === place) ?? null;
}
