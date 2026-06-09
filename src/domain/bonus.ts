// The 7 bonus categories, verbatim from architecture/00 §2.3 & 04 §8.
// settles_after_stage encodes the progressive-settlement trigger (05 §4):
// e.g. R16_PARTICIPANT ("участники 1/8 финала" = the 16 teams that REACH the
// Round of 16 = winners of the Round of 32) settles after the R32 matches.

export interface SeedBonusCategory {
  id: string;
  nameRu: string;
  nameEn: string;
  itemCount: number;
  pointsPerCorrect: number;
  isKeyTiebreaker: boolean;
  settlesAfterStage: string;
  itemType: "TEAM" | "PLAYER";
  sortOrder: number;
}

export const BONUS_CATEGORIES: SeedBonusCategory[] = [
  {
    id: "GROUP_WINNER",
    nameRu: "Победители групп",
    nameEn: "Group winners",
    itemCount: 12,
    pointsPerCorrect: 3,
    isKeyTiebreaker: false,
    settlesAfterStage: "GROUP",
    itemType: "TEAM",
    sortOrder: 1,
  },
  {
    id: "R16_PARTICIPANT",
    nameRu: "Участники 1/8 финала",
    nameEn: "Round of 16 participants",
    itemCount: 16,
    pointsPerCorrect: 5,
    isKeyTiebreaker: false,
    settlesAfterStage: "R32",
    itemType: "TEAM",
    sortOrder: 2,
  },
  {
    id: "QF_PARTICIPANT",
    nameRu: "Участники 1/4 финала",
    nameEn: "Quarter-final participants",
    itemCount: 8,
    pointsPerCorrect: 7,
    isKeyTiebreaker: true,
    settlesAfterStage: "R16",
    itemType: "TEAM",
    sortOrder: 3,
  },
  {
    id: "SF_PARTICIPANT",
    nameRu: "Участники полуфинала",
    nameEn: "Semi-final participants",
    itemCount: 4,
    pointsPerCorrect: 8,
    isKeyTiebreaker: true,
    settlesAfterStage: "QF",
    itemType: "TEAM",
    sortOrder: 4,
  },
  {
    id: "FINALIST",
    nameRu: "Участники финала",
    nameEn: "Finalists",
    itemCount: 2,
    pointsPerCorrect: 10,
    isKeyTiebreaker: true,
    settlesAfterStage: "SF",
    itemType: "TEAM",
    sortOrder: 5,
  },
  {
    id: "CHAMPION",
    nameRu: "Победитель",
    nameEn: "Champion",
    itemCount: 1,
    pointsPerCorrect: 12,
    isKeyTiebreaker: true,
    settlesAfterStage: "FINAL",
    itemType: "TEAM",
    sortOrder: 6,
  },
  {
    id: "TOP_SCORER",
    nameRu: "Лучший бомбардир",
    nameEn: "Top scorer",
    itemCount: 1,
    pointsPerCorrect: 7,
    isKeyTiebreaker: false,
    settlesAfterStage: "FINAL",
    itemType: "PLAYER",
    sortOrder: 7,
  },
];
