// The 48 teams and 12 groups of WC-2026, verbatim from architecture/03 §2
// (verified against the official FIFA final draw). `code` is our stable internal
// id (= FIFA 3-letter code); name_ru is the UI label. Listing order within a
// group is just draw order, NOT final standings.

export const GROUP_CODES = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"] as const;
export type GroupCode = (typeof GROUP_CODES)[number];

export interface SeedTeam {
  code: string; // stable internal id = FIFA code
  nameRu: string;
  nameEn: string;
  groupCode: GroupCode;
  /** Draw position 1..4 within the group (listing order, not standings). */
  pos: 1 | 2 | 3 | 4;
}

export const TEAMS: SeedTeam[] = [
  // Group A
  { code: "MEX", nameRu: "Мексика", nameEn: "Mexico", groupCode: "A", pos: 1 },
  { code: "RSA", nameRu: "ЮАР", nameEn: "South Africa", groupCode: "A", pos: 2 },
  { code: "KOR", nameRu: "Южная Корея", nameEn: "South Korea", groupCode: "A", pos: 3 },
  { code: "CZE", nameRu: "Чехия", nameEn: "Czechia", groupCode: "A", pos: 4 },
  // Group B
  { code: "CAN", nameRu: "Канада", nameEn: "Canada", groupCode: "B", pos: 1 },
  { code: "BIH", nameRu: "Босния и Герцеговина", nameEn: "Bosnia & Herzegovina", groupCode: "B", pos: 2 },
  { code: "QAT", nameRu: "Катар", nameEn: "Qatar", groupCode: "B", pos: 3 },
  { code: "SUI", nameRu: "Швейцария", nameEn: "Switzerland", groupCode: "B", pos: 4 },
  // Group C
  { code: "BRA", nameRu: "Бразилия", nameEn: "Brazil", groupCode: "C", pos: 1 },
  { code: "MAR", nameRu: "Марокко", nameEn: "Morocco", groupCode: "C", pos: 2 },
  { code: "HAI", nameRu: "Гаити", nameEn: "Haiti", groupCode: "C", pos: 3 },
  { code: "SCO", nameRu: "Шотландия", nameEn: "Scotland", groupCode: "C", pos: 4 },
  // Group D
  { code: "USA", nameRu: "США", nameEn: "USA", groupCode: "D", pos: 1 },
  { code: "PAR", nameRu: "Парагвай", nameEn: "Paraguay", groupCode: "D", pos: 2 },
  { code: "AUS", nameRu: "Австралия", nameEn: "Australia", groupCode: "D", pos: 3 },
  { code: "TUR", nameRu: "Турция", nameEn: "Türkiye", groupCode: "D", pos: 4 },
  // Group E
  { code: "GER", nameRu: "Германия", nameEn: "Germany", groupCode: "E", pos: 1 },
  { code: "CUW", nameRu: "Кюрасао", nameEn: "Curaçao", groupCode: "E", pos: 2 },
  { code: "CIV", nameRu: "Кот-д'Ивуар", nameEn: "Ivory Coast", groupCode: "E", pos: 3 },
  { code: "ECU", nameRu: "Эквадор", nameEn: "Ecuador", groupCode: "E", pos: 4 },
  // Group F
  { code: "NED", nameRu: "Нидерланды", nameEn: "Netherlands", groupCode: "F", pos: 1 },
  { code: "JPN", nameRu: "Япония", nameEn: "Japan", groupCode: "F", pos: 2 },
  { code: "SWE", nameRu: "Швеция", nameEn: "Sweden", groupCode: "F", pos: 3 },
  { code: "TUN", nameRu: "Тунис", nameEn: "Tunisia", groupCode: "F", pos: 4 },
  // Group G
  { code: "BEL", nameRu: "Бельгия", nameEn: "Belgium", groupCode: "G", pos: 1 },
  { code: "EGY", nameRu: "Египет", nameEn: "Egypt", groupCode: "G", pos: 2 },
  { code: "IRN", nameRu: "Иран", nameEn: "Iran", groupCode: "G", pos: 3 },
  { code: "NZL", nameRu: "Новая Зеландия", nameEn: "New Zealand", groupCode: "G", pos: 4 },
  // Group H
  { code: "ESP", nameRu: "Испания", nameEn: "Spain", groupCode: "H", pos: 1 },
  { code: "CPV", nameRu: "Кабо-Верде", nameEn: "Cape Verde", groupCode: "H", pos: 2 },
  { code: "KSA", nameRu: "Саудовская Аравия", nameEn: "Saudi Arabia", groupCode: "H", pos: 3 },
  { code: "URU", nameRu: "Уругвай", nameEn: "Uruguay", groupCode: "H", pos: 4 },
  // Group I
  { code: "FRA", nameRu: "Франция", nameEn: "France", groupCode: "I", pos: 1 },
  { code: "SEN", nameRu: "Сенегал", nameEn: "Senegal", groupCode: "I", pos: 2 },
  { code: "IRQ", nameRu: "Ирак", nameEn: "Iraq", groupCode: "I", pos: 3 },
  { code: "NOR", nameRu: "Норвегия", nameEn: "Norway", groupCode: "I", pos: 4 },
  // Group J
  { code: "ARG", nameRu: "Аргентина", nameEn: "Argentina", groupCode: "J", pos: 1 },
  { code: "ALG", nameRu: "Алжир", nameEn: "Algeria", groupCode: "J", pos: 2 },
  { code: "AUT", nameRu: "Австрия", nameEn: "Austria", groupCode: "J", pos: 3 },
  { code: "JOR", nameRu: "Иордания", nameEn: "Jordan", groupCode: "J", pos: 4 },
  // Group K
  { code: "POR", nameRu: "Португалия", nameEn: "Portugal", groupCode: "K", pos: 1 },
  { code: "COD", nameRu: "ДР Конго", nameEn: "Congo DR", groupCode: "K", pos: 2 },
  { code: "UZB", nameRu: "Узбекистан", nameEn: "Uzbekistan", groupCode: "K", pos: 3 },
  { code: "COL", nameRu: "Колумбия", nameEn: "Colombia", groupCode: "K", pos: 4 },
  // Group L
  { code: "ENG", nameRu: "Англия", nameEn: "England", groupCode: "L", pos: 1 },
  { code: "CRO", nameRu: "Хорватия", nameEn: "Croatia", groupCode: "L", pos: 2 },
  { code: "GHA", nameRu: "Гана", nameEn: "Ghana", groupCode: "L", pos: 3 },
  { code: "PAN", nameRu: "Панама", nameEn: "Panama", groupCode: "L", pos: 4 },
];
