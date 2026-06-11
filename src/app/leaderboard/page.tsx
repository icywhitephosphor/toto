"use client";
import { useState } from "react";
import useSWR from "swr";
import { useBootstrap } from "@/lib/client/bootstrap";
import { PageHead, CardSkeleton, Empty } from "@/components/ui";
import { fmtRub, plural } from "@/lib/client/format";
import { BONUS_LABELS } from "@/lib/client/labels";
import { PRIZES } from "@/domain/prizes";
import type { Leaderboard, LeaderboardRow } from "@/lib/client/types";

const MEDALS = ["🥇", "🥈", "🥉"];
const PRIZE_POOL = PRIZES.reduce((sum, p) => sum + p.amount, 0);

export default function LeaderboardPage() {
  const { data: boot } = useBootstrap();
  const { data, isLoading } = useSWR<Leaderboard>("/leaderboard", { refreshInterval: 25000 });
  const meId = boot?.participant?.id;
  const [open, setOpen] = useState<string | null>(null);

  const rows = data?.rows ?? [];

  return (
    <div>
      <PageHead
        eyebrow={rows.length > 0 ? plural(rows.length, "участник", "участника", "участников") : undefined}
        title="Таблица"
      />

      {isLoading && <CardSkeleton count={6} />}
      {!isLoading && rows.length === 0 && <Empty title="Пока пусто" sub="Очки появятся после первых результатов." />}

      {rows.length > 0 && (
        <div className="card">
          {rows.map((r) => (
            <Row key={r.participant_id} r={r} me={r.participant_id === meId} open={open === r.participant_id}
              onToggle={() => setOpen(open === r.participant_id ? null : r.participant_id)} />
          ))}
        </div>
      )}

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

function Row({ r, me, open, onToggle }: { r: LeaderboardRow; me: boolean; open: boolean; onToggle: () => void }) {
  const settled = Object.entries(r.bonus_breakdown).filter(([, v]) => v !== null);
  // Medals and prize-zone styling only once real points exist — before that the
  // whole roster is tied at place 1 and gold across the board looks broken.
  const scored = r.total_points > 0;
  const medal = scored && r.place <= 3 ? MEDALS[r.place - 1] : null;
  return (
    <div>
      <button
        className={`lb-row ${scored ? `p${r.place}` : ""} ${scored && r.prize ? "prize" : ""} ${me ? "me" : ""}`}
        style={{ width: "100%", background: me ? "var(--pitch-faint)" : "transparent", border: "none", textAlign: "left", cursor: "pointer" }}
        onClick={onToggle}
      >
        <span className="lb-place">{medal ?? r.place}</span>
        <span>
          <span className="lb-name">{r.display_name}{me && <span className="faint"> · вы</span>}</span>
          <span className="lb-sub">
            матчи {r.match_points} · бонусы {r.bonus_points}
            {r.prize && scored && <span style={{ color: "var(--gold)" }}> · приз {fmtRub(r.prize.amount)}</span>}
          </span>
        </span>
        <span className={`lb-pts ${r.total_points === 0 ? "zero" : ""}`}>{r.total_points}</span>
      </button>

      {open && (
        <div className="rise" style={{ padding: "4px 14px 16px 60px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 14px" }}>
          <Detail label="Матчи (всего)" value={r.match_points} />
          <Detail label="Плей-офф матчи" value={r.playoff_match_points} />
          <Detail label="Бонусы (всего)" value={r.bonus_points} />
          <Detail label="Ключевые бонусы" value={r.key_bonus_points} />
          {settled.map(([cid, v]) => (
            <Detail key={cid} label={BONUS_LABELS[cid] ?? cid} value={v as number} dim />
          ))}
        </div>
      )}
    </div>
  );
}

function Detail({ label, value, dim }: { label: string; value: number; dim?: boolean }) {
  return (
    <div className="row between" style={{ fontSize: 12.5 }}>
      <span className={dim ? "faint" : "muted"}>{label}</span>
      <span className="mono" style={{ color: dim ? "var(--ink-dim)" : "var(--ink)" }}>{value}</span>
    </div>
  );
}
