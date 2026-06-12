// worldcup26.ir — free community API used as the LIVE-score + group-result
// source (football-data's free tier withholds scores; balldontlie gates
// /matches behind a higher tier). No auth. IMPORTANT: their match `id` does
// NOT follow FIFA numbering (verified: 41/72 group ids point at different
// fixtures), so matches are mapped by team pair, never by id. Their
// `fifa_code` values match our teams.code exactly (incl. URU, all 48 checked).
//
// Trust policy: GROUP results may finalize from here (auto-confirm); play-off
// games get live display only — the payload has no extra-time/penalty split,
// which the canonical play-off score requires (FD paid tier or admin covers it).

export interface Wc26Game {
  id: string;
  type: string; // "group" | "r32" | ...
  group?: string | null;
  home_team_id: string;
  away_team_id: string;
  home_score: string | number | null;
  away_score: string | number | null;
  finished: string | boolean;
  time_elapsed?: string | number | null;
}

interface Wc26Team {
  id: string;
  fifa_code: string;
}

// Their `type` → our stage codes. Unknown types are skipped defensively.
const TYPE_TO_STAGE: Record<string, string> = {
  group: "GROUP",
  r32: "R32",
  r16: "R16",
  qf: "QF",
  sf: "SF",
  third: "THIRD",
  third_place: "THIRD",
  final: "FINAL",
};

export interface Wc26Score {
  homeCode: string;
  awayCode: string;
  stage: string;
  home: number;
  away: number;
  finished: boolean;
  minute: number | null;
}

const num = (v: string | number | null | undefined): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Pure: raw game + team map → a typed score row (null if not mappable). */
export function mapGame(g: Wc26Game, codeByTeamId: Map<string, string>): Wc26Score | null {
  const stage = TYPE_TO_STAGE[g.type];
  if (!stage) return null;
  const homeCode = codeByTeamId.get(g.home_team_id);
  const awayCode = codeByTeamId.get(g.away_team_id);
  if (!homeCode || !awayCode) return null; // unresolved knockout slots ("0")
  const home = num(g.home_score);
  const away = num(g.away_score);
  if (home == null || away == null) return null;
  return {
    homeCode,
    awayCode,
    stage,
    home,
    away,
    finished: String(g.finished).toUpperCase() === "TRUE",
    minute: num(g.time_elapsed ?? null),
  };
}

const BASE = "https://worldcup26.ir";

// Teams are static — cache long. Games are fetched every poll.
let teamCache: { at: number; map: Map<string, string> } | null = null;

export interface Wc26Fetch {
  ok: boolean;
  httpStatus: number | null;
  scores: Wc26Score[];
  error?: string;
}

export async function fetchWc26Scores(): Promise<Wc26Fetch> {
  try {
    if (!teamCache || Date.now() - teamCache.at > 3600_000) {
      const tres = await fetch(`${BASE}/get/teams`, { signal: AbortSignal.timeout(8000) });
      if (!tres.ok) return { ok: false, httpStatus: tres.status, scores: [], error: `teams HTTP ${tres.status}` };
      const tbody = (await tres.json()) as { teams?: Wc26Team[] };
      teamCache = { at: Date.now(), map: new Map((tbody.teams ?? []).map((t) => [t.id, t.fifa_code])) };
    }
    const res = await fetch(`${BASE}/get/games`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { ok: false, httpStatus: res.status, scores: [], error: `games HTTP ${res.status}` };
    const body = (await res.json()) as { games?: Wc26Game[] };
    const scores: Wc26Score[] = [];
    for (const g of body.games ?? []) {
      const s = mapGame(g, teamCache.map);
      if (s) scores.push(s);
    }
    return { ok: true, httpStatus: res.status, scores };
  } catch (err) {
    return { ok: false, httpStatus: null, scores: [], error: err instanceof Error ? err.message : String(err) };
  }
}
