// Client-safe static metadata for the 7 bonus categories (mirror of
// src/domain/bonus.ts; the seed is the source of truth server-side).

export interface BonusMeta {
  id: string;
  nameRu: string;
  itemCount: number;
  pointsPerCorrect: number;
  itemType: "TEAM" | "PLAYER";
  hint: string;
}

export const BONUS_META: BonusMeta[] = [
  { id: "GROUP_WINNER", nameRu: "Победители групп", itemCount: 12, pointsPerCorrect: 3, itemType: "TEAM", hint: "12 команд, занявших 1-е место в группах" },
  { id: "R16_PARTICIPANT", nameRu: "Участники 1/8 финала", itemCount: 16, pointsPerCorrect: 5, itemType: "TEAM", hint: "16 победителей 1/16 финала" },
  { id: "QF_PARTICIPANT", nameRu: "Участники 1/4 финала", itemCount: 8, pointsPerCorrect: 7, itemType: "TEAM", hint: "8 команд, вышедших в четвертьфинал" },
  { id: "SF_PARTICIPANT", nameRu: "Участники полуфинала", itemCount: 4, pointsPerCorrect: 8, itemType: "TEAM", hint: "4 полуфиналиста" },
  { id: "FINALIST", nameRu: "Участники финала", itemCount: 2, pointsPerCorrect: 10, itemType: "TEAM", hint: "2 финалиста" },
  { id: "CHAMPION", nameRu: "Победитель", itemCount: 1, pointsPerCorrect: 12, itemType: "TEAM", hint: "Чемпион мира" },
  { id: "TOP_SCORER", nameRu: "Лучший бомбардир", itemCount: 1, pointsPerCorrect: 7, itemType: "PLAYER", hint: "Имя обладателя «Золотой бутсы»" },
];

export const BONUS_LABELS: Record<string, string> = Object.fromEntries(BONUS_META.map((c) => [c.id, c.nameRu]));
