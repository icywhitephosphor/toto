"use client";
// Real bracket geometry: every column shares one canvas 16 slots tall, a tile
// in round k sits vertically centred between its two feeders (top of tile i =
// ((2^k−1)/2 + i·2^k)·SLOT), pairs are joined by a bracket line whose arrow
// continues into the next column's tile stub. Columns snap-scroll horizontally
// (Flashscore-style); round chips also scroll the page to the column's content.
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

const TILE_H = 100;
const GAP = 14;
const SLOT = TILE_H + GAP;
const CANVAS_H = 16 * SLOT - GAP;
/** Top of tile i in round k (k = 0 for R32). */
const tileY = (k: number, i: number) => ((2 ** k - 1) / 2 + i * 2 ** k) * SLOT;

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

function Tile({ m, top, linked }: { m: ApiMatch; top: number; linked: boolean }) {
  const r = m.result;
  return (
    <Link href={`/match/${m.id}`} className={`bk-tile ${linked ? "linked" : ""}`} style={{ top, height: TILE_H }}>
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
        <span>{m.kickoff_at ? `${fmtMsk(m.kickoff_at)} МСК` : ""}</span>
      </div>
    </Link>
  );
}

export function PlayoffBracket() {
  const { data, isLoading } = useSWR<MatchesResp>("/matches");
  const [round, setRound] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Column order follows the bracket, not the match number: adjacent tiles are
  // the two feeders of the same next-round game (89 = W74 vs W77 → 74 next to
  // 77). Walk back from the final via the W<no> slots; numeric order is the
  // fallback if the chain is broken.
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
    const final = numeric[ROUNDS.length - 1].find((m) => m.stage === "FINAL");
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
    return [...walked, numeric[ROUNDS.length - 1]];
  }, [data]);

  function go(i: number) {
    setRound(i);
    const el = wrapRef.current;
    const first = el?.children[0] as HTMLElement | undefined;
    if (!el || !first) return;
    // Horizontal-only column snap + a gentle page scroll to where this round's
    // tiles actually live on the shared canvas.
    el.scrollTo({ left: i * (first.offsetWidth + 12), behavior: "smooth" });
    const top = el.getBoundingClientRect().top + window.scrollY + tileY(Math.min(i, 4), 0);
    window.scrollTo({ top: Math.max(0, top - 180), behavior: "smooth" });
  }

  function onScroll() {
    const el = wrapRef.current;
    const first = el?.children[0] as HTMLElement | undefined;
    if (!el || !first) return;
    const step = first.offsetWidth + 12;
    const i = Math.max(0, Math.min(ROUNDS.length - 1, Math.round(el.scrollLeft / step)));
    if (i !== round) setRound(i);
  }

  if (isLoading && !data) return <div className="skel" style={{ height: 280 }} />;

  const finalCol = byRound[4] ?? [];
  const finalMatch = finalCol.find((m) => m.stage === "FINAL");
  const thirdMatch = finalCol.find((m) => m.stage === "THIRD");
  const finalY = tileY(4, 0);

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
        {ROUNDS.map((r, k) => (
          <div key={r.key} className="bk-col" style={{ height: CANVAS_H }}>
            {k < 4 ? (
              <>
                {byRound[k].map((m, i) => (
                  <Tile key={m.id} m={m} top={tileY(k, i)} linked={k > 0} />
                ))}
                {Array.from({ length: Math.floor(byRound[k].length / 2) }, (_, j) => (
                  <div
                    key={j}
                    className="bk-conn"
                    style={{ top: tileY(k, 2 * j) + TILE_H / 2, height: tileY(k, 2 * j + 1) - tileY(k, 2 * j) }}
                  />
                ))}
              </>
            ) : (
              <>
                <div className="bk-roundlabel" style={{ top: finalY - 26 }}>🏆 Финал</div>
                {finalMatch && <Tile m={finalMatch} top={finalY} linked />}
                {thirdMatch && (
                  <>
                    <div className="bk-roundlabel" style={{ top: finalY + TILE_H + 34 }}>Матч за 3-е место</div>
                    <Tile m={thirdMatch} top={finalY + TILE_H + 60} linked={false} />
                  </>
                )}
              </>
            )}
          </div>
        ))}
      </div>
      <div className="faint center" style={{ fontSize: 11, marginTop: 8 }}>
        ≈ — прогноз по текущим таблицам групп, состав пар ещё может измениться
      </div>
    </div>
  );
}
