// Prize pool (FR-17). Money is handled offline (01 §7.5 default); the app only
// *shows* the amounts. Split per the OFFICIAL rules sheet («Основные правила
// товарищеского тотализатора ЧМ-2026»): six places, 19/10/8/4/3/2 тыс. ₽ —
// exactly the 23×2000 ₽ = 46 000 ₽ pool. Tune in one place if the organizer
// changes the split.
export interface Prize {
  place: number;
  amount: number; // RUB
  label: string;
}

export const PRIZE_POOL = 46_000; // RUB

export const PRIZES: Prize[] = [
  { place: 1, amount: 19000, label: "1 место" },
  { place: 2, amount: 10000, label: "2 место" },
  { place: 3, amount: 8000, label: "3 место" },
  { place: 4, amount: 4000, label: "4 место" },
  { place: 5, amount: 3000, label: "5 место" },
  { place: 6, amount: 2000, label: "6 место" },
];

export function prizeForPlace(place: number): Prize | null {
  return PRIZES.find((p) => p.place === place) ?? null;
}
