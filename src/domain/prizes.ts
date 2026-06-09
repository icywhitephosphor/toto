// Prize pool for the top 5 places (FR-17). Money is handled offline (01 §7.5
// default); the app only *shows* the amounts. Default split of the 21×2000 ₽ =
// 42 000 ₽ pool — the organizer can tune these numbers in one place.
export interface Prize {
  place: number;
  amount: number; // RUB
  label: string;
}

export const PRIZES: Prize[] = [
  { place: 1, amount: 18000, label: "1 место" },
  { place: 2, amount: 10000, label: "2 место" },
  { place: 3, amount: 6000, label: "3 место" },
  { place: 4, amount: 5000, label: "4 место" },
  { place: 5, amount: 3000, label: "5 место" },
];

export function prizeForPlace(place: number): Prize | null {
  return PRIZES.find((p) => p.place === place) ?? null;
}
