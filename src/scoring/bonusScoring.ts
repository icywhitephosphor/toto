// Bonus scoring (architecture/05 §4). Team categories score set-intersection ×
// points-per-correct; order is irrelevant. Top-scorer matches the single
// official Golden Boot player the admin sets (01 §7.1 default).

export function scoreBonusTeams(
  predicted: Set<string>,
  actual: Set<string>,
  ptsPerCorrect: number,
): number {
  let n = 0;
  for (const id of predicted) if (actual.has(id)) n++;
  return n * ptsPerCorrect;
}

// Player names are free text typed by participants, so matching the admin's
// official Golden Boot name must tolerate cosmetic differences: case, leading/
// trailing/duplicated whitespace, Latin diacritics (Mbappé == Mbappe) and the
// Russian ё/е split (Дембеле == Дембелё). Anything stronger (transliteration)
// is intentionally out of scope — those are genuinely different spellings the
// organizer should reconcile at settle time.
export const normalizePlayerName = (s: string): string =>
  s
    .replace(/[ёЁ]/g, "е") // Russian ё/Ё → е, before any decomposition
    .normalize("NFD")
    // Strip combining marks ONLY after a Latin base letter (Mbappé → Mbappe).
    // A blanket strip would corrupt Cyrillic й (и + breve U+0306) → и, so we
    // leave Cyrillic decompositions to recompose untouched below.
    .replace(/([a-zA-Z])[̀-ͯ]+/g, "$1")
    .normalize("NFC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

export function scoreTopScorer(
  predictedPlayer: string,
  actualPlayer: string | null,
  pts: number,
): number {
  if (!actualPlayer) return 0;
  return normalizePlayerName(predictedPlayer) === normalizePlayerName(actualPlayer) ? pts : 0;
}
