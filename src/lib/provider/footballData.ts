// football-data.org v4 client + pure mapping helpers (08). Free tier: 10
// req/min; ONE call to /competitions/WC/matches returns all 104 matches, and
// the response carries throttle headers (x-requests-available-minute) that the
// worker respects. Fetching lives here; everything else is pure and unit-tested.
import { env } from "@/lib/env";
import type { Stage } from "@/scoring";

export interface FdScorePart {
  home: number | null;
  away: number | null;
}

export interface FdTeam {
  id: number | null;
  name: string | null;
  tla: string | null;
}

export interface FdMatch {
  id: number;
  utcDate: string;
  // SCHEDULED | TIMED | IN_PLAY | PAUSED | FINISHED | SUSPENDED | POSTPONED | CANCELLED | AWARDED
  status: string;
  stage: string;
  group: string | null; // "GROUP_A" … "GROUP_L"
  homeTeam: FdTeam;
  awayTeam: FdTeam;
  score: {
    winner: string | null;
    duration: "REGULAR" | "EXTRA_TIME" | "PENALTY_SHOOTOUT";
    fullTime: FdScorePart;
    regularTime?: FdScorePart;
    extraTime?: FdScorePart;
    penalties?: FdScorePart;
  };
}

export const FD_STAGE_TO_LOCAL: Record<string, Stage> = {
  GROUP_STAGE: "GROUP",
  LAST_32: "R32",
  LAST_16: "R16",
  QUARTER_FINALS: "QF",
  SEMI_FINALS: "SF",
  THIRD_PLACE: "THIRD",
  FINAL: "FINAL",
};

// FD TLAs equal FIFA codes for 47 of the 48 qualified teams.
const FD_TLA_TO_CODE: Record<string, string> = { URY: "URU" };

export const fdCode = (tla: string | null | undefined): string | null =>
  tla ? (FD_TLA_TO_CODE[tla] ?? tla) : null;

export interface FdFetchResult {
  httpStatus: number;
  matches: FdMatch[] | null;
  quotaRemaining: number | null;
  error?: string;
}

export async function fetchWcMatches(): Promise<FdFetchResult> {
  const res = await fetch("https://api.football-data.org/v4/competitions/WC/matches", {
    headers: { "X-Auth-Token": env.fdToken! },
  });
  const quota = Number(res.headers.get("x-requests-available-minute"));
  const quotaRemaining = Number.isFinite(quota) ? quota : null;
  if (!res.ok) {
    return { httpStatus: res.status, matches: null, quotaRemaining, error: `HTTP ${res.status}` };
  }
  const body = (await res.json()) as { matches?: FdMatch[] };
  return { httpStatus: res.status, matches: body.matches ?? [], quotaRemaining };
}

export interface MappedResult {
  resultStatus: "FT" | "AET" | "PEN";
  baseHome: number;
  baseAway: number;
  penHome: number | null;
  penAway: number | null;
}

/**
 * FD score → our result fields in OUR home/away orientation (`swapped` when our
 * fixture lists the teams the other way round). Our `base` is the score after
 * regulation + extra time; FD's `fullTime` includes the shootout bump for
 * PENALTY_SHOOTOUT matches, so base is rebuilt from regularTime + extraTime.
 */
export function mapFinishedScore(fd: FdMatch, swapped: boolean): MappedResult | null {
  if (fd.status !== "FINISHED") return null;
  const pick = (p?: FdScorePart): { home: number; away: number } | null =>
    p && p.home != null && p.away != null
      ? swapped
        ? { home: p.away, away: p.home }
        : { home: p.home, away: p.away }
      : null;

  const full = pick(fd.score.fullTime);
  if (!full) return null;

  if (fd.score.duration === "REGULAR") {
    return { resultStatus: "FT", baseHome: full.home, baseAway: full.away, penHome: null, penAway: null };
  }
  if (fd.score.duration === "EXTRA_TIME") {
    return { resultStatus: "AET", baseHome: full.home, baseAway: full.away, penHome: null, penAway: null };
  }
  const reg = pick(fd.score.regularTime);
  const ext = pick(fd.score.extraTime) ?? { home: 0, away: 0 };
  const pens = pick(fd.score.penalties);
  if (!reg || !pens || pens.home === pens.away) return null;
  return {
    resultStatus: "PEN",
    baseHome: reg.home + ext.home,
    baseAway: reg.away + ext.away,
    penHome: pens.home,
    penAway: pens.away,
  };
}
