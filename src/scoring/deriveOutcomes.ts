// Auto-derive the *actual* outcome of each derivable bonus category straight
// from match results, so the organizer never hand-enters group winners or
// bracket participants. Pure: match results in → team-id sets out. recomputeAll
// persists these as source='AUTO' bonus_outcomes; a manual settle (source=
// 'MANUAL') always wins over the derived value (05 §4).
//
// Derivation rules:
//   GROUP_WINNER    → rank-1 of each of the 12 groups. Ranking: points → goal
//                     difference → goals for, then head-to-head points → GD → GF
//                     among teams tied on all three (FIFA criteria 1–6). A
//                     residual dead tie (fair-play / drawing of lots, which we
//                     have no data for) is left for a manual settle.
//   R16_PARTICIPANT → winners of the 16 R32 matches (= the 16 teams reaching R16)
//   QF_PARTICIPANT  → winners of the 8 R16 matches
//   SF_PARTICIPANT  → winners of the 4 QF matches
//   FINALIST        → winners of the 2 SF matches
//   CHAMPION        → winner of the final
//   TOP_SCORER      → NOT derivable (no goal data); always manual.
//
// All scores are the canonical *toto* score, matching winner_team_id and the
// money-path everywhere else (05 §2).

export interface DeriveMatch {
  stage: string; // GROUP | R32 | R16 | QF | SF | THIRD | FINAL
  groupCode: string | null;
  homeTeamId: string | null;
  awayTeamId: string | null;
  totoHome: number | null;
  totoAway: number | null;
  winnerTeamId: string | null;
  /** Already passes recompute's "feeds scoring" filter (FT/AET/PEN + toto + GROUP|confirmed). */
  usable: boolean;
}

export interface Derivation {
  categoryId: string;
  /** At least one actual team is known → write outcomes so points start to
   *  accrue. Categories settle PARTIALLY: each confirmed team is credited as
   *  soon as it's known, without waiting for the whole stage (set intersection
   *  is monotonic, so a participant's points only grow). */
  ready: boolean;
  /** The actual set is final — every team that reaches this stage is known and
   *  won't change. Until then a not-yet-advanced pick is *pending*, not a miss. */
  complete: boolean;
  /** The confirmed-so-far team-id set, or null when nothing is known yet or the
   *  result is genuinely ambiguous (GROUP_WINNER dead tie). */
  teamIds: string[] | null;
  /** GROUP_WINNER only: groups whose winner is a dead tie needing a manual call. */
  ambiguousGroups?: string[];
}

interface Tally {
  teamId: string;
  pts: number;
  gf: number;
  ga: number;
}

/** Tally points/goals over the games played strictly between `among` teams. */
function tallyGames(games: DeriveMatch[], among: Set<string>): Tally[] {
  const t = new Map<string, Tally>();
  const get = (id: string): Tally => {
    let r = t.get(id);
    if (!r) {
      r = { teamId: id, pts: 0, gf: 0, ga: 0 };
      t.set(id, r);
    }
    return r;
  };
  for (const g of games) {
    const h = g.homeTeamId;
    const a = g.awayTeamId;
    if (!h || !a || !among.has(h) || !among.has(a)) continue;
    const hg = g.totoHome!;
    const ag = g.totoAway!;
    const hr = get(h);
    const ar = get(a);
    hr.gf += hg;
    hr.ga += ag;
    ar.gf += ag;
    ar.ga += hg;
    if (hg > ag) hr.pts += 3;
    else if (hg < ag) ar.pts += 3;
    else {
      hr.pts += 1;
      ar.pts += 1;
    }
  }
  return [...t.values()];
}

const gd = (t: Tally): number => t.gf - t.ga;
const cmp = (a: Tally, b: Tally): number => b.pts - a.pts || gd(b) - gd(a) || b.gf - a.gf;

/** Winner of one group, or null if a residual dead tie needs a manual call. */
function groupWinner(games: DeriveMatch[], teamIds: string[]): string | null {
  const full = tallyGames(games, new Set(teamIds)).sort(cmp);
  if (full.length === 0) return null;
  const leaders = full.filter((r) => cmp(r, full[0]) === 0);
  if (leaders.length === 1) return full[0].teamId;
  // Tied on points/GD/GF → head-to-head mini-table among exactly those teams.
  const sub = new Set(leaders.map((r) => r.teamId));
  const h2h = tallyGames(games, sub).sort(cmp);
  const hLeaders = h2h.filter((r) => cmp(r, h2h[0]) === 0);
  return hLeaders.length === 1 ? h2h[0].teamId : null;
}

function deriveGroupWinners(matches: DeriveMatch[]): Derivation {
  const group = matches.filter((m) => m.stage === "GROUP");
  // Group winners are settled as a set once every group match is in (the
  // standings — and thus rank 1 — can shift until the last whistle), so this
  // stays all-or-nothing rather than partial.
  const ready = group.length > 0 && group.every((m) => m.usable);
  if (!ready) return { categoryId: "GROUP_WINNER", ready: false, complete: false, teamIds: null };

  const byGroup = new Map<string, Set<string>>();
  for (const m of group) {
    if (!m.groupCode || !m.homeTeamId || !m.awayTeamId) continue;
    if (!byGroup.has(m.groupCode)) byGroup.set(m.groupCode, new Set());
    byGroup.get(m.groupCode)!.add(m.homeTeamId);
    byGroup.get(m.groupCode)!.add(m.awayTeamId);
  }

  const winners: string[] = [];
  const ambiguous: string[] = [];
  for (const code of [...byGroup.keys()].sort()) {
    const w = groupWinner(group, [...byGroup.get(code)!]);
    if (w) winners.push(w);
    else ambiguous.push(code);
  }
  if (ambiguous.length) {
    return { categoryId: "GROUP_WINNER", ready: true, complete: false, teamIds: null, ambiguousGroups: ambiguous };
  }
  return { categoryId: "GROUP_WINNER", ready: true, complete: true, teamIds: winners };
}

function deriveStageWinners(
  categoryId: string,
  matches: DeriveMatch[],
  stage: string,
  expected: number,
): Derivation {
  const sm = matches.filter((m) => m.stage === stage);
  // Partial settlement: credit each confirmed winner the moment it's known,
  // without waiting for the whole stage. The actual set only grows, so points
  // are monotonic. `complete` flips once every match of the stage is decided.
  const winners = sm.filter((m) => m.usable && m.winnerTeamId != null).map((m) => m.winnerTeamId!);
  const complete = sm.length === expected && winners.length === expected;
  return { categoryId, ready: winners.length > 0, complete, teamIds: winners.length > 0 ? winners : null };
}

/**
 * Derive every auto-settleable category from the full match list (every match,
 * with `usable` precomputed; not-yet-played matches present with usable=false so
 * stage-completeness is detected correctly). TOP_SCORER is intentionally absent.
 */
export function deriveBonusOutcomes(matches: DeriveMatch[]): Derivation[] {
  return [
    deriveGroupWinners(matches),
    deriveStageWinners("R16_PARTICIPANT", matches, "R32", 16),
    deriveStageWinners("QF_PARTICIPANT", matches, "R16", 8),
    deriveStageWinners("SF_PARTICIPANT", matches, "QF", 4),
    deriveStageWinners("FINALIST", matches, "SF", 2),
    deriveStageWinners("CHAMPION", matches, "FINAL", 1),
  ];
}
