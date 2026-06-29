"use client";
// Per-participant breakdown shared by the leaderboard row drill-in
// (variant="inline") and the profile page (variant="full"). Filter chips
// (Точный счёт / Исход / Х2 / Плей-офф / Бонусы / Мимо) toggle which slice of
// the participant's bets is listed. Counts are over REAL bets only (NO_BET
// excluded). The inline default shows only point-scoring bets so a 100-match
// season stays readable in a table row; the full profile lists everything.
import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { STAGE_LABEL, Empty } from "@/components/ui";
import { pointsClass, fmtPts } from "@/lib/client/points";
import { flag } from "@/lib/client/flags";
import type { ParticipantStats, StatMatch, StatBonusCat } from "@/lib/client/types";

type Filter = "exact" | "outcome" | "x2" | "playoff" | "bonus" | "miss";

export function ParticipantBreakdown({ participantId, variant }: { participantId: string; variant: "inline" | "full" }) {
  const { data } = useSWR<ParticipantStats>(`/participants/${participantId}/stats`);
  const [filter, setFilter] = useState<Filter | null>(null);

  const bet = useMemo(() => (data?.matches ?? []).filter((m) => m.kind !== "NO_BET"), [data]);
  const noBet = (data?.matches.length ?? 0) - bet.length;
  const bonus = data?.bonus ?? [];

  if (!data) return <div className="skel mt-12" style={{ height: 44 }} />;

  const counts = {
    exact: bet.filter((m) => m.kind === "EXACT").length,
    outcome: bet.filter((m) => m.kind === "OUTCOME").length,
    miss: bet.filter((m) => m.kind === "MISS").length,
    x2: bet.filter((m) => m.x2).length,
    playoff: bet.filter((m) => m.stage !== "GROUP").length,
    bonus: bonus.length,
  };

  if (bet.length === 0 && bonus.length === 0) {
    return <div className="faint mt-12" style={{ fontSize: 12 }}>Сыгранных ставок пока нет.</div>;
  }

  const chips: Array<{ key: Filter; label: string; count: number; cls: string }> = [
    { key: "exact", label: "Точный счёт", count: counts.exact, cls: "pts-exact" },
    { key: "outcome", label: "Исход", count: counts.outcome, cls: "pts-pos" },
    { key: "x2", label: "Х2", count: counts.x2, cls: "pts-exact" },
    { key: "playoff", label: "Плей-офф", count: counts.playoff, cls: "" },
    { key: "bonus", label: "Бонусы", count: counts.bonus, cls: "" },
    { key: "miss", label: "Мимо", count: counts.miss, cls: "" },
  ];

  // Default list: inline → only point-scoring bets (keeps a table row short);
  // full → every real bet, chronological.
  const shownMatches: StatMatch[] =
    filter === "exact" ? bet.filter((m) => m.kind === "EXACT")
    : filter === "outcome" ? bet.filter((m) => m.kind === "OUTCOME")
    : filter === "miss" ? bet.filter((m) => m.kind === "MISS")
    : filter === "x2" ? bet.filter((m) => m.x2)
    : filter === "playoff" ? bet.filter((m) => m.stage !== "GROUP")
    : filter === "bonus" ? []
    : variant === "inline" ? bet.filter((m) => m.points > 0)
    : bet;

  return (
    <div className="mt-12">
      <div className="row wrap gap-6">
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            disabled={c.count === 0}
            className={`chip ${c.cls} ${filter === c.key ? "sel" : ""}`}
            onClick={() => setFilter(filter === c.key ? null : c.key)}
          >
            {c.label} · {c.count}
          </button>
        ))}
      </div>

      {filter === "bonus" ? (
        <BonusList bonus={bonus} />
      ) : (
        <>
          <div className="stack mt-8" style={{ gap: 4 }}>
            {shownMatches.map((m) => (
              <MatchRow key={m.match_id} m={m} />
            ))}
          </div>
          {shownMatches.length === 0 && (
            <div className="faint mt-8" style={{ fontSize: 12 }}>
              {filter ? "Нет ставок в этой категории." : "Пока без очков."}
            </div>
          )}
          {filter === null && variant === "inline" && (counts.miss > 0 || noBet > 0) && (
            <div className="faint mt-8" style={{ fontSize: 11 }}>
              мимо {counts.miss}{noBet > 0 ? ` · без ставки ${noBet}` : ""} · весь список — в профиле
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MatchRow({ m }: { m: StatMatch }) {
  const cls = pointsClass(m.points, { exact: m.kind === "EXACT", x2: m.x2 });
  return (
    <Link href={`/match/${m.match_id}`} className="row between gap-8" style={{ fontSize: 12.5, padding: "5px 0", borderBottom: "1px solid var(--line)" }}>
      <span className="muted" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {m.stage === "GROUP" ? `№${m.fifa_match_no}` : STAGE_LABEL[m.stage]} · {flag(m.home.code)} {m.home.name_ru} — {m.away.name_ru} {flag(m.away.code)}
        {m.result && <span className="mono"> {m.result[0]}:{m.result[1]}</span>}
      </span>
      <span className="row gap-6" style={{ flex: "0 0 auto" }}>
        <span className="mono faint">{m.pred ? `${m.pred[0]}:${m.pred[1]}${m.x2 ? " ×2" : ""}` : "—"}</span>
        <span className={`mono ${cls}`} style={{ minWidth: 26, textAlign: "right" }}>{fmtPts(m.points)}</span>
      </span>
    </Link>
  );
}

function BonusList({ bonus }: { bonus: StatBonusCat[] }) {
  if (bonus.length === 0) {
    return <div className="faint mt-8" style={{ fontSize: 12 }}>Бонусных ставок нет.</div>;
  }
  return (
    <div className="stack mt-8" style={{ gap: 8 }}>
      {bonus.map((cat) => (
        <div key={cat.category_id} style={{ paddingBottom: 8, borderBottom: "1px solid var(--line)" }}>
          <div className="row between" style={{ fontSize: 12.5 }}>
            <span className="muted">{cat.name_ru}</span>
            <span className="row gap-6" style={{ flex: "0 0 auto" }}>
              {cat.settled && !cat.complete && <span className="faint" style={{ fontSize: 11 }}>идёт</span>}
              <span className={`mono ${cat.settled ? pointsClass(cat.points_earned ?? 0) : "faint"}`}>
                {cat.settled ? fmtPts(cat.points_earned ?? 0) : "ещё не разыграно"}
              </span>
            </span>
          </div>
          <div className="row wrap gap-6" style={{ marginTop: 5 }}>
            {cat.items.map((it, i) => (
              <span
                key={i}
                className={`chip ${it.hit === true ? "chip-open" : it.hit === false ? "chip-locked" : ""}`}
                style={{ textTransform: "none", letterSpacing: 0 }}
              >
                {it.player_name ?? `${flag(it.code)} ${it.name_ru}`}
                {it.hit === true && " ✓"}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
