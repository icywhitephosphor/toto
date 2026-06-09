"use client";
import { useState } from "react";
import useSWR from "swr";
import { useBootstrap } from "@/lib/client/bootstrap";
import { PageHead, CardSkeleton, Empty } from "@/components/ui";
import { fmtRub } from "@/lib/client/format";
import { BONUS_LABELS } from "@/lib/client/labels";
import type { Leaderboard, LeaderboardRow } from "@/lib/client/types";

export default function LeaderboardPage() {
  const { data: boot } = useBootstrap();
  const { data, isLoading } = useSWR<Leaderboard>("/leaderboard", { refreshInterval: 25000 });
  const meId = boot?.participant?.id;
  const [open, setOpen] = useState<string | null>(null);

  const rows = data?.rows ?? [];

  return (
    <div>
      <PageHead
        eyebrow={data?.reason ? `Обновлено · ${data.reason}` : "Обновляется каждые 25 c"}
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

      <div className="banner gold mt-16">
        Призовой фонд распределяется между топ-5. «По росту :)» — финальный тай-брейк организатора.
      </div>
    </div>
  );
}

function Row({ r, me, open, onToggle }: { r: LeaderboardRow; me: boolean; open: boolean; onToggle: () => void }) {
  const settled = Object.entries(r.bonus_breakdown).filter(([, v]) => v !== null);
  return (
    <div>
      <button
        className={`lb-row p${r.place} ${me ? "me" : ""}`}
        style={{ width: "100%", background: me ? "rgba(196,247,63,0.06)" : "transparent", border: "none", textAlign: "left", cursor: "pointer" }}
        onClick={onToggle}
      >
        <span className="lb-place">{r.place}</span>
        <span>
          <span className="lb-name">{r.display_name}{me && <span className="faint"> · вы</span>}</span>
          <span className="lb-sub">
            матчи {r.match_points} · бонусы {r.bonus_points}
            {r.prize && r.total_points > 0 && <span style={{ color: "var(--gold)" }}> · {fmtRub(r.prize.amount)}</span>}
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
