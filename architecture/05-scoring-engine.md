# 05 — Scoring Engine

The scoring engine is a **pure, deterministic, side-effect-free TypeScript module** (`packages/scoring`).
Given results and bets, it returns points. It never touches the DB, the clock, or the network, so it is
trivially unit-testable and reproducible. The persistence/recompute wrapper that calls it is described in
§7.

> Golden rule: **the engine is the only place points are computed.** The UI may *preview* points, but the
> stored value always comes from a server-side recompute through this module.

## 1. Types & constants

```ts
export type Stage = 'GROUP' | 'R32' | 'R16' | 'QF' | 'SF' | 'THIRD' | 'FINAL';
export type Outcome = 'HOME' | 'DRAW' | 'AWAY';

export const MATCH_POINTS: Record<Stage, { exact: number; outcome: number; x2Allowed: boolean }> = {
  GROUP: { exact: 2,  outcome: 1, x2Allowed: false },
  R32:   { exact: 3,  outcome: 2, x2Allowed: true  },
  R16:   { exact: 4,  outcome: 3, x2Allowed: true  },
  QF:    { exact: 5,  outcome: 4, x2Allowed: true  },
  SF:    { exact: 7,  outcome: 5, x2Allowed: true  },
  THIRD: { exact: 7,  outcome: 5, x2Allowed: true  },
  FINAL: { exact: 10, outcome: 7, x2Allowed: true  },
};

export const PLAYOFF_STAGES: Stage[] = ['R32', 'R16', 'QF', 'SF', 'THIRD', 'FINAL'];

export const outcome = (h: number, a: number): Outcome =>
  h > a ? 'HOME' : h < a ? 'AWAY' : 'DRAW';
```

## 2. Canonical play-off ("toto") score

The bet is on the **final score**. For play-offs we fold the penalty shootout into a "+1 goal" for the
winner, so the toto score is always decisive. (Rules example: ET 2:2, pens 5:3 → toto 3:2.)

```ts
export interface RawResult {
  baseHome: number;            // goals after regulation (+ extra time for play-offs)
  baseAway: number;
  penHome?: number | null;     // shootout score, null/undefined if no shootout
  penAway?: number | null;
}

export interface TotoScore { home: number; away: number; }

export function totoScore(r: RawResult): TotoScore {
  const hadShootout = r.penHome != null && r.penAway != null && r.penHome !== r.penAway;
  if (hadShootout) {
    return r.penHome! > r.penAway!
      ? { home: r.baseHome + 1, away: r.baseAway }
      : { home: r.baseHome,     away: r.baseAway + 1 };
  }
  return { home: r.baseHome, away: r.baseAway };
}
```

For a **group** match, `penHome/penAway` are absent → `toto = base` (draws allowed). This `TotoScore` is
what gets persisted to `match_results.toto_home/toto_away` (`04` §4).

## 3. Match-bet scoring

Implements `01` §6.1 exactly: score and outcome do **not** stack; ×2 only in play-offs; missing both with
×2 subtracts the **un-doubled** exact-score points.

```ts
export interface MatchBet { predHome: number; predAway: number; x2: boolean; }

/** Points for one match bet against the canonical toto score. No bet → 0. */
export function scoreMatchBet(stage: Stage, bet: MatchBet | null, toto: TotoScore): number {
  if (!bet) return 0;                                   // FR-14: no bet → 0 points
  const rule = MATCH_POINTS[stage];
  const x2 = bet.x2 && rule.x2Allowed;                  // ×2 silently ignored where disallowed
  const exact = bet.predHome === toto.home && bet.predAway === toto.away;
  const rightOutcome = outcome(bet.predHome, bet.predAway) === outcome(toto.home, toto.away);

  if (exact)        return x2 ? rule.exact * 2  : rule.exact;
  if (rightOutcome) return x2 ? rule.outcome * 2 : rule.outcome;
  return x2 ? -rule.exact : 0;                           // miss both: ×2 → −exact (un-doubled), else 0
}
```

### Optional "draw + penalty-winner" entry (open question `01` §7.3)
If you choose UX (b) — a player enters a regulation draw and picks who wins the shootout — derive the
toto bet before scoring; the scoring call itself is unchanged:

```ts
export function betToToto(b: { predHome: number; predAway: number; penWinner?: 'HOME' | 'AWAY' }): MatchBet & TotoScore {
  if (b.predHome === b.predAway && b.penWinner) {       // a predicted draw decided on pens
    return b.penWinner === 'HOME'
      ? { predHome: b.predHome + 1, predAway: b.predAway, x2: false, home: 0, away: 0 } as any
      : { predHome: b.predHome, predAway: b.predAway + 1, x2: false, home: 0, away: 0 } as any;
  }
  return { predHome: b.predHome, predAway: b.predAway, x2: false, home: 0, away: 0 } as any;
}
```
(Keep it simple: store the *derived decisive* `pred_home/pred_away` in `match_bets`, plus `pen_winner`
for display. Then `scoreMatchBet` needs no special case.)

## 4. Bonus scoring & settlement

Each team category scores **set intersection × points-per-correct**; order is irrelevant.

```ts
export function scoreBonusTeams(predicted: Set<string>, actual: Set<string>, ptsPerCorrect: number): number {
  let n = 0;
  for (const id of predicted) if (actual.has(id)) n++;
  return n * ptsPerCorrect;
}

export function scoreTopScorer(predictedPlayer: string, actualPlayer: string | null, pts: number): number {
  if (!actualPlayer) return 0;
  return normalize(predictedPlayer) === normalize(actualPlayer) ? pts : 0;   // see top-scorer tie note
}
const normalize = (s: string) => s.trim().toLowerCase();
```

### Settlement triggers
A bonus category is scored only once its trigger stage completes; until then it contributes 0. This is
why the leaderboard fills in bonus points progressively.

```ts
export const BONUS_SETTLES_AFTER: Record<string, Stage> = {
  GROUP_WINNER:    'GROUP',
  R16_PARTICIPANT: 'R32',     // 16 teams that REACH R16 = winners of matches 73–88
  QF_PARTICIPANT:  'R16',
  SF_PARTICIPANT:  'QF',
  FINALIST:        'SF',
  CHAMPION:        'FINAL',
  TOP_SCORER:      'FINAL',
};
```

### Computing the "actual set" (`bonus_outcomes`)
| Category | Actual set = | Trigger |
|----------|--------------|---------|
| `GROUP_WINNER` | team finishing 1st in each group (standings) | all group matches FINAL |
| `R16_PARTICIPANT` | winners of matches 73–88 | all R32 FINAL+confirmed |
| `QF_PARTICIPANT` | winners of matches 89–96 | all R16 FINAL+confirmed |
| `SF_PARTICIPANT` | winners of matches 97–100 | all QF FINAL+confirmed |
| `FINALIST` | winners of matches 101–102 | both SF FINAL+confirmed |
| `CHAMPION` | winner of match 104 | FINAL confirmed |
| `TOP_SCORER` | Golden Boot player | end of tournament (admin sets) |

A "winner" comes from `match_results` (`toto_home` vs `toto_away`, never a play-off draw). Group winners
come from provider standings or are computed with the FIFA group tie-breakers in `03` §3.

## 5. Tie-breakers

Sort comparator implementing `00` §2.4 — four levels, highest place first:

```ts
export interface Standing {
  participantId: string;
  total: number;            // total_points
  playoffMatch: number;     // playoff_match_points (R32..FINAL match bets)
  keyBonus: number;         // QF_PARTICIPANT + SF_PARTICIPANT + FINALIST + CHAMPION
  tiebreakRank: number | null;  // manual "по росту" order; lower = higher place
}

export function compareStandings(a: Standing, b: Standing): number {
  if (a.total        !== b.total)        return b.total - a.total;               // 1) total ↓
  if (a.playoffMatch !== b.playoffMatch) return b.playoffMatch - a.playoffMatch; // 2) play-off match ↓
  if (a.keyBonus     !== b.keyBonus)     return b.keyBonus - a.keyBonus;         // 3) key bonus ↓
  const ar = a.tiebreakRank ?? Number.POSITIVE_INFINITY;                          // 4) "по росту :)"
  const br = b.tiebreakRank ?? Number.POSITIVE_INFINITY;
  if (ar !== br) return ar - br;
  return a.participantId.localeCompare(b.participantId);  // stable: table never flickers
}
```

Two people who are still equal after all three real criteria are genuinely tied; `tiebreakRank` lets the
organizer impose the "height" order by hand, and the id fallback keeps rendering deterministic. For
**prize money** on a true tie, apply the ruling from `01` §7.2 (default: split the tied places' pooled
money).

## 6. Worked examples = the test suite

Every example from the rules sheet must pass. (These are verified programmatically in `15` /the
verification step; the table doubles as the spec.)

```ts
import { describe, it, expect } from 'vitest';
import { scoreMatchBet, totoScore } from './matchScoring';

const cases: Array<[string, Stage, MatchBet, RawResult, number]> = [
  // [name, stage, bet, rawResult, expected]
  ['group: outcome only',    'GROUP', { predHome:0, predAway:4, x2:false }, { baseHome:0, baseAway:3 },  1],
  ['R32: outcome ×2',        'R32',   { predHome:2, predAway:1, x2:true  }, { baseHome:3, baseAway:1 },  4],
  ['R16: miss both ×2 (−)',  'R16',   { predHome:0, predAway:2, x2:true  }, { baseHome:1, baseAway:0 }, -4],
  ['R16: outcome ×2',        'R16',   { predHome:2, predAway:0, x2:true  }, { baseHome:1, baseAway:0 },  6],
  ['R16: exact ×2',          'R16',   { predHome:1, predAway:0, x2:true  }, { baseHome:1, baseAway:0 },  8],
  ['QF: wrong, no ×2',       'QF',    { predHome:2, predAway:1, x2:false }, { baseHome:1, baseAway:2 },  0],
  ['SF: exact ×2',           'SF',    { predHome:2, predAway:1, x2:true  }, { baseHome:2, baseAway:1 }, 14],
  ['FINAL: exact ×2',        'FINAL', { predHome:0, predAway:3, x2:true  }, { baseHome:0, baseAway:3 }, 20],
  ['FINAL: miss both ×2 (−)','FINAL', { predHome:2, predAway:1, x2:true  }, { baseHome:0, baseAway:3 },-10],
];

describe('scoreMatchBet — rules-sheet examples', () => {
  for (const [name, stage, bet, raw, expected] of cases) {
    it(name, () => expect(scoreMatchBet(stage, bet, totoScore(raw))).toBe(expected));
  }
});

// Canonical penalty score: ET 2:2, pens 5:3 → toto 3:2
it('totoScore: penalty +1 to winner', () =>
  expect(totoScore({ baseHome:2, baseAway:2, penHome:5, penAway:3 })).toEqual({ home:3, away:2 }));

// ×2 ignored in group stage (defensive)
it('group ignores ×2', () =>
  expect(scoreMatchBet('GROUP', { predHome:1, predAway:0, x2:true }, { home:1, away:0 } as any)).toBe(2));
```

All nine table rows map 1:1 to the rules sheet (`01` §6.5). Expected sums: the negative cases (−4, −10)
are the un-doubled exact-score points, matching "вычитается количество баллов за счет (не удвоенное)".

## 7. Recompute (the impure wrapper)

A thin orchestrator turns engine outputs into rows. It is **idempotent**: running it twice yields the
same `score_events` and the same leaderboard.

```text
recomputeAll(tournament):
  begin transaction
  # 1) match points — only matches whose result is usable
  for m in matches where result usable(m):          # GROUP: FINAL; PLAYOFF: FINAL & confirmed
     toto = (m.toto_home, m.toto_away)
     for p in participants:
        bet = matchBet(p, m)                          # may be null
        pts = scoreMatchBet(m.stage, bet, toto)
        upsert score_events (p, source=MATCH, unit_key='M:'+m.id, match_id=m.id,
                             stage=m.stage, points=pts, detail={...})
  # 2) bonus points — only categories whose trigger stage is complete
  for c in bonus_categories where settled(c):         # has bonus_outcomes
     actual = set(bonus_outcomes(c))
     for p in participants:
        predicted = set(bonus_bet_items(p, c))
        pts = c.item_type=='PLAYER'
              ? scoreTopScorer(pred, actualPlayer, c.points)
              : scoreBonusTeams(predicted, actual, c.points)
        upsert score_events (p, source=BONUS, unit_key='B:'+c.id, category_id=c.id,
                             stage=c.settles_after_stage, points=pts, detail={hits:n})
  # 3) leaderboard snapshot
  rows = select * from v_standings
  ranked = sort(rows, compareStandings); assign places; attach prizes (top-5)
  insert leaderboard_snapshots(rows=ranked, reason=trigger)
  commit
```

Triggers for a recompute: a match result is confirmed/changed, a bonus category is settled, an admin
override, or a manual "recompute" (`06` `/api/admin/recalculate`). At 21 participants × ~111 scorable
units a full recompute is well under a second, so we never need incremental scoring (a Track B option).

## 8. Edge cases the engine/wrapper must handle

| Case | Behaviour |
|------|-----------|
| No bet for a match | 0 points (no row, or a 0 row); never a penalty |
| ×2 set on a group bet | ×2 ignored (defensive; API also rejects it) |
| Predicted draw in a play-off | Outcome can't match a decisive toto → loses; with ×2, −exact. (UX `01` §7.3 helps avoid accidental draws) |
| Result changed after scoring | Recompute upserts new points; `audit_log` records old→new |
| Provider says FT but play-off not confirmed | Result not "usable" yet → contributes 0 until admin confirms |
| Top-scorer tie | `scoreTopScorer` matches the single official player the admin sets (ruling `01` §7.1) |
| Bonus category not yet settled | Contributes 0; appears as "pending" in the UI/leaderboard breakdown |
| Cancelled/abandoned match | `result_status='CANCELLED'` → excluded from scoring; admin decides handling |
