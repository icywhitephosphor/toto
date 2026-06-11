"use client";
// Flashscore-style mobile bracket: one column per knockout round, horizontal
// snap-scroll, round chips on top. Pairs that feed the same next-round match
// are joined by a bracket connector with an arrow. Slots without resolved
// teams show the projection from the live group tables (≈) or a human label.
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { slotLabel } from "./ui";
import { flag } from "@/lib/client/flags";
import { fmtMsk } from "@/lib/client/format";
import type { ApiMatch, ApiTeam, Stage } from "@/lib/client/types";

interface MatchesResp { matches: ApiMatch[] }

const ROUNDS: Array<{ key: string; label: string; stages: Stage[] }> = [
  { key: "R32", label: "1/16", stages: ["R32"] },
  { key: "R16", label: "1/8", stages: ["R16"] },
  { key: "QF", label: "1/4", stages: ["QF"] },
  { key: "SF", label: "1/2", stages: ["SF"] },
  { key: "FINAL", label: "Финал", stages: ["FINAL", "THIRD"] },
];

function TeamRow({ team, projected, slot, score, winner }: {
  team: ApiTeam | null;
  projected: ApiTeam | null | undefined;
  slot: string | null;
  score: number | null;
  winner: boolean;
}) {
  return (
    <div className={`bk-team ${winner ? "win" : ""}`}>
      {team ? (
        <span className="bk-name">
          <span className="tflag" style={{ fontSize: 14 }}>{flag(team.code)}</span> {team.name_ru}
        </span>
      ) : projected ? (
        <span className="bk-name proj">
          <span className="tflag" style={{ fontSize: 14 }}>{flag(projected.code)}</span> ≈ {projected.name_ru}
        </span>
      ) : (
        <span className="bk-name tbd">{slotLabel(slot) ?? "Уточняется"}</span>
      )}
      <span className="bk-score">{score ?? "–"}</span>
    </div>
  );
}

function Tile({ m }: { m: ApiMatch }) {
  const r = m.result;
  return (
    <Link href={`/match/${m.id}`} className="bk-tile">
      {m.stage === "THIRD" && <div className="eyebrow" style={{ marginBottom: 6 }}>Матч за 3-е место</div>}
      <TeamRow
        team={m.home_team}
        projected={m.projected_home}
        slot={m.home_slot}
        score={r?.toto_home ?? null}
        winner={!!r?.winner_team_id && r.winner_team_id === m.home_team?.id}
      />
      <TeamRow
        team={m.away_team}
        projected={m.projected_away}
        slot={m.away_slot}
        score={r?.toto_away ?? null}
        winner={!!r?.winner_team_id && r.winner_team_id === m.away_team?.id}
      />
      <div className="bk-meta">
        <span>№{m.fifa_match_no}{m.city ? ` · ${m.city}` : ""}</span>
        <span>{m.kickoff_at ? `${fmtMsk(m.kickoff_at)} МСК` : "дата уточняется"}</span>
      </div>
    </Link>
  );
}

/** Adjacent matches feed the same next-round game — join them visually. */
function chunkPairs(list: ApiMatch[]): ApiMatch[][] {
  const out: ApiMatch[][] = [];
  for (let i = 0; i < list.length; i += 2) out.push(list.slice(i, i + 2));
  return out;
}

export function PlayoffBracket() {
  const { data, isLoading } = useSWR<MatchesResp>("/matches");
  const [round, setRound] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Column order must follow the bracket, not the match number: adjacent tiles
  // have to be the two feeders of the same next-round game (e.g. R16 game 89 is
  // W74 vs W77, so 74 and 77 sit together). Walk back from the final via the
  // W<no> slots; fall back to numeric order if the chain is broken.
  const byRound = useMemo(() => {
    const all = data?.matches ?? [];
    const numeric = ROUNDS.map((r) =>
      all
        .filter((m) => r.stages.includes(m.stage))
        .sort((a, b) =>
          a.stage !== b.stage ? (a.stage === "FINAL" ? -1 : 1) : a.fifa_match_no - b.fifa_match_no,
        ),
    );
    const byNo = new Map(all.map((m) => [m.fifa_match_no, m]));
    const finalCol = numeric[ROUNDS.length - 1];
    const final = finalCol.find((m) => m.stage === "FINAL");
    if (!final) return numeric;

    const walked: ApiMatch[][] = [];
    let cur = [final];
    for (let i = ROUNDS.length - 2; i >= 0; i--) {
      const prev: ApiMatch[] = [];
      for (const m of cur) {
        for (const slot of [m.home_slot, m.away_slot]) {
          const w = slot ? /^W(\d+)$/.exec(slot) : null;
          const feeder = w ? byNo.get(Number(w[1])) : null;
          if (feeder) prev.push(feeder);
        }
      }
      if (prev.length !== numeric[i].length) return numeric; // broken chain
      walked.unshift(prev);
      cur = prev;
    }
    return [...walked, finalCol];
  }, [data]);

  // Horizontal-only scrolling: scrollIntoView can also scroll the page
  // vertically, and a vertical jerk inside the Mini App triggers the
  // swipe-down-to-close gesture.
  function go(i: number) {
    setRound(i);
    const el = wrapRef.current;
    const first = el?.children[0] as HTMLElement | undefined;
    if (!el || !first) return;
    el.scrollTo({ left: i * (first.offsetWidth + 12), behavior: "smooth" });
  }

  function onScroll() {
    const el = wrapRef.current;
    const first = el?.children[0] as HTMLElement | undefined;
    if (!el || !first) return;
    const step = first.offsetWidth + 12; // column + gap
    const i = Math.max(0, Math.min(ROUNDS.length - 1, Math.round(el.scrollLeft / step)));
    if (i !== round) setRound(i);
  }

  if (isLoading && !data) return <div className="skel" style={{ height: 280 }} />;

  return (
    <div>
      <div className="segmented" style={{ marginBottom: 12 }}>
        {ROUNDS.map((r, i) => (
          <button key={r.key} className={`seg ${round === i ? "active" : ""}`} onClick={() => go(i)}>
            {r.label}
          </button>
        ))}
      </div>
      <div className="bracket" ref={wrapRef} onScroll={onScroll}>
        {ROUNDS.map((r, i) => (
          <div key={r.key} className="bk-col">
            {r.key === "FINAL"
              ? byRound[i].map((m) => <Tile key={m.id} m={m} />)
              : chunkPairs(byRound[i]).map((pair) => (
                  <div key={pair[0].id} className="bk-pair">
                    {pair.map((m) => <Tile key={m.id} m={m} />)}
                  </div>
                ))}
          </div>
        ))}
      </div>
      <div className="faint center" style={{ fontSize: 11, marginTop: 4 }}>
        ≈ — прогноз по текущим таблицам групп, состав пар ещё может измениться
      </div>
    </div>
  );
}
