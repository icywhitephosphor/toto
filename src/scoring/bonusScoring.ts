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

const normalize = (s: string) => s.trim().toLowerCase();

export function scoreTopScorer(
  predictedPlayer: string,
  actualPlayer: string | null,
  pts: number,
): number {
  if (!actualPlayer) return 0;
  return normalize(predictedPlayer) === normalize(actualPlayer) ? pts : 0;
}
