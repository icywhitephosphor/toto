"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { useBootstrap } from "@/lib/client/bootstrap";
import { PageHead, CardSkeleton, Empty, STAGE_LABEL } from "@/components/ui";
import { fmtRub, plural } from "@/lib/client/format";
import { ParticipantBreakdown } from "@/components/ParticipantBreakdown";
import { pointsClass, fmtPts } from "@/lib/client/points";
import { flag } from "@/lib/client/flags";
import { useFlip } from "@/lib/client/useFlip";
import { PRIZES, PRIZE_POOL, prizeForPlace } from "@/domain/prizes";
import type { Leaderboard, LeaderboardRow, LiveBlock, LiveRow } from "@/lib/client/types";

const MEDALS = ["🥇", "🥈", "🥉"];

export default function LeaderboardPage() {
  const { data: boot } = useBootstrap();
  const { data, isLoading } = useSWR<Leaderboard>("/leaderboard", {
    // Faster polling while matches are in play — the worker refreshes live
    // scores every 15s, so 10s keeps the table feeling alive without spam.
    refreshInterval: (latest) => (latest?.live?.active ? 10_000 : 25_000),
  });
  const meId = boot?.participant?.id;
  const [open, setOpen] = useState<string | null>(null);
  const [view, setView] = useState<"official" | "live">("official");

  const rows = data?.rows ?? [];
  const live = data?.live;
  const liveActive = !!live?.active;
  const mode = liveActive && view === "live" ? "live" : "official";

  return (
    <div>
      <PageHead
        eyebrow={rows.length > 0 ? plural(rows.length, "участник", "участника", "участников") : undefined}
        title="Таблица"
      />

      {liveActive && (
        <div className="segmented" style={{ marginBottom: 12 }}>
          <button className={`seg ${mode === "official" ? "active" : ""}`} onClick={() => setView("official")}>
            Официальная
          </button>
          <button className={`seg ${mode === "live" ? "active" : ""}`} onClick={() => setView("live")}>
            <span className="dot-live" /> Live
          </button>
        </div>
      )}

      {isLoading && <CardSkeleton count={6} />}
      {!isLoading && rows.length === 0 && <Empty title="Пока пусто" sub="Очки появятся после первых результатов." />}

      {rows.length > 0 && mode === "live" && live ? (
        <LiveTable rows={rows} live={live} meId={meId} open={open} setOpen={setOpen} />
      ) : rows.length > 0 ? (
        <OfficialTable rows={rows} meId={meId} open={open} setOpen={setOpen} />
      ) : null}

      <div className="card mt-16">
        <div className="card-pad row between" style={{ paddingBottom: 8 }}>
          <div className="section-title" style={{ fontSize: 16 }}>Призовой фонд</div>
          <span className="chip chip-gold">{fmtRub(PRIZE_POOL)}</span>
        </div>
        <div className="card-pad" style={{ paddingTop: 0 }}>
          {PRIZES.map((p) => (
            <div key={p.place} className="prize-row">
              <span className="prize-medal">{MEDALS[p.place - 1] ?? p.place}</span>
              <span className="muted" style={{ fontSize: 14 }}>{p.label}</span>
              <span className="mono" style={{ color: "var(--gold)", fontWeight: 700 }}>{fmtRub(p.amount)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function OfficialTable({ rows, meId, open, setOpen }: {
  rows: LeaderboardRow[];
  meId?: string;
  open: string | null;
  setOpen: (v: string | null) => void;
}) {
  const flipRef = useFlip(rows.map((r) => r.participant_id).join(","));
  return (
    <div className="card" ref={flipRef}>
      {rows.map((r, i) => (
        <div key={r.participant_id} data-flip-key={r.participant_id}>
          <Row r={r} pos={i + 1} me={r.participant_id === meId} open={open === r.participant_id}
            onToggle={() => setOpen(open === r.participant_id ? null : r.participant_id)} />
        </div>
      ))}
    </div>
  );
}

// ---- Live view: provisional totals, ▲N/▼N movement vs the official table ----
function LiveTable({ rows, live, meId, open, setOpen }: {
  rows: LeaderboardRow[];
  live: LiveBlock;
  meId?: string;
  open: string | null;
  setOpen: (v: string | null) => void;
}) {
  const byId = useMemo(() => new Map(rows.map((r) => [r.participant_id, r])), [rows]);
  const ordered = useMemo(() => [...live.rows].sort((a, b) => a.live_pos - b.live_pos), [live]);
  const matchByIdMap = useMemo(() => new Map(live.matches.map((m) => [m.match_id, m])), [live]);
  const flipRef = useFlip(ordered.map((r) => r.participant_id).join(","));

  return (
    <>
      {/* What is in play right now */}
      <div className="row wrap gap-6" style={{ marginBottom: 10 }}>
        {live.matches.map((m) => (
          <Link key={m.match_id} href={`/match/${m.match_id}`} className="chip chip-live">
            <span className="dot" /> {flag(m.home.code)} {m.score[0]}:{m.score[1]} {flag(m.away.code)}
            {m.status === "AWAITING_CONFIRM" && " · ждёт подтверждения"}
          </Link>
        ))}
      </div>

      <div className="card" ref={flipRef}>
        {ordered.map((lr) => {
          const r = byId.get(lr.participant_id);
          if (!r) return null;
          return (
            <div key={lr.participant_id} data-flip-key={lr.participant_id}>
              <LiveRowView lr={lr} r={r} me={lr.participant_id === meId} matchById={matchByIdMap}
                open={open === lr.participant_id}
                onToggle={() => setOpen(open === lr.participant_id ? null : lr.participant_id)} />
            </div>
          );
        })}
      </div>
      <div className="faint center" style={{ fontSize: 11, marginTop: 6 }}>
        ~ предварительно, по текущему счёту · официальный зачёт — по финальному свистку
      </div>
    </>
  );

  function LiveRowView({ lr, r, me, open, onToggle, matchById }: {
    lr: LiveRow;
    r: LeaderboardRow;
    me: boolean;
    open: boolean;
    onToggle: () => void;
    matchById: Map<string, LiveBlock["matches"][number]>;
  }) {
    const mv = lr.moves;
    return (
      <div>
        <button
          className={`lb-row ${lr.live_pos <= 3 ? `p${lr.live_pos}` : ""} ${me ? "me" : ""}`}
          style={{ width: "100%", background: me ? "var(--pitch-faint)" : "transparent", border: "none", textAlign: "left", cursor: "pointer", gridTemplateColumns: "34px 26px 1fr auto" }}
          onClick={onToggle}
        >
          <span className="lb-place">{lr.live_pos}</span>
          <span className={`mv ${mv > 0 ? "mv-up" : mv < 0 ? "mv-down" : "mv-flat"}`}>
            {mv > 0 ? `▲${mv}` : mv < 0 ? `▼${-mv}` : "·"}
          </span>
          <span>
            <span className="lb-name">{r.display_name}{me && <span className="faint"> · вы</span>}</span>
            <span className="lb-sub">
              официально {r.total_points}
              {lr.delta !== 0 && <span className={pointsClass(lr.delta)}> · live {fmtPts(lr.delta)}</span>}
            </span>
          </span>
          <span className={`lb-pts ${lr.delta !== 0 ? pointsClass(lr.delta) : ""}`}>{lr.live_total}</span>
        </button>

        {open && (
          <div className="rise" style={{ padding: "4px 14px 14px 60px" }}>
            {lr.contribs.length === 0 && (
              <div className="faint" style={{ fontSize: 12 }}>Нет ставок на идущие матчи.</div>
            )}
            {lr.contribs.map((c) => {
              const m = matchById.get(c.match_id);
              if (!m) return null;
              const exact = c.pred[0] === m.score[0] && c.pred[1] === m.score[1];
              const cls = pointsClass(c.points, { exact, x2: c.x2 });
              return (
                <Link key={c.match_id} href={`/match/${c.match_id}`} className="row between gap-8" style={{ fontSize: 12.5, padding: "5px 0", borderBottom: "1px solid var(--line)" }}>
                  <span className="muted" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {m.stage === "GROUP" ? `№${m.fifa_match_no}` : STAGE_LABEL[m.stage]} · {flag(m.home.code)} {m.home.name_ru} {m.score[0]}:{m.score[1]} {m.away.name_ru} {flag(m.away.code)}
                  </span>
                  <span className="row gap-6" style={{ flex: "0 0 auto" }}>
                    <span className="mono faint">{c.pred[0]}:{c.pred[1]}{c.x2 ? " ×2" : ""}</span>
                    <span className={`mono ${cls}`} style={{ minWidth: 32, textAlign: "right" }}>~{fmtPts(c.points)}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    );
  }
}

// pos is the visual position in the current order (1..N): while everyone is
// tied at zero the list is alphabetical and still numbered straight through,
// per the organizer's call. The prize markers follow this visual position.
function Row({ r, pos, me, open, onToggle }: { r: LeaderboardRow; pos: number; me: boolean; open: boolean; onToggle: () => void }) {
  const prize = prizeForPlace(pos);
  return (
    <div>
      <button
        className={`lb-row ${pos <= 3 ? `p${pos}` : ""} ${prize ? "prize" : ""} ${me ? "me" : ""}`}
        style={{ width: "100%", background: me ? "var(--pitch-faint)" : "transparent", border: "none", textAlign: "left", cursor: "pointer" }}
        onClick={onToggle}
      >
        <span className="lb-place">{pos}</span>
        <span>
          <span className="lb-name">{r.display_name}{me && <span className="faint"> · вы</span>}</span>
          <span className="lb-sub">
            матчи {r.match_points} · бонусы {r.bonus_points}
            {prize && <span style={{ color: "var(--gold)" }}> · {fmtRub(prize.amount)}</span>}
          </span>
        </span>
        <span className={`lb-pts ${r.total_points === 0 ? "zero" : ""}`}>{r.total_points}</span>
      </button>

      {open && (
        <div className="rise" style={{ padding: "4px 14px 16px 60px" }}>
          <Link
            href={`/participant/${r.participant_id}`}
            className="row"
            style={{ gap: 6, fontSize: 12.5, color: "var(--pitch)", fontWeight: 600 }}
          >
            Открыть профиль →
          </Link>
          <ParticipantBreakdown participantId={r.participant_id} variant="inline" />
        </div>
      )}
    </div>
  );
}

