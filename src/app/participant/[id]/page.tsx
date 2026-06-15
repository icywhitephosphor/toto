"use client";
import { use } from "react";
import useSWR from "swr";
import { BackLink, Empty, CardSkeleton } from "@/components/ui";
import { ParticipantBreakdown } from "@/components/ParticipantBreakdown";
import { fmtRub } from "@/lib/client/format";
import { fmtPts } from "@/lib/client/points";
import type { ParticipantStats } from "@/lib/client/types";

const MEDALS = ["🥇", "🥈", "🥉"];

export default function ParticipantProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, isLoading } = useSWR<ParticipantStats>(`/participants/${id}/stats`);

  if (isLoading) {
    return (
      <div style={{ paddingTop: 8 }}>
        <BackLink href="/leaderboard" label="К таблице" />
        <div className="mt-12"><CardSkeleton count={1} /></div>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div style={{ paddingTop: 8 }}>
        <BackLink href="/leaderboard" label="К таблице" />
        <div className="mt-12"><Empty title="Участник не найден" /></div>
      </div>
    );
  }

  const r = data.rank;
  const posLabel = r ? (r.official_pos <= 3 ? MEDALS[r.official_pos - 1] : r.official_pos) : "—";

  return (
    <div className="rise" style={{ paddingTop: 8 }}>
      <BackLink href="/leaderboard" label="К таблице" />

      <div className="card card-pad mt-8">
        <div className="row between" style={{ alignItems: "center", gap: 12 }}>
          <div className="row gap-12" style={{ alignItems: "center", minWidth: 0 }}>
            <span className="lb-place" style={{ fontSize: 24 }}>{posLabel}</span>
            <div style={{ minWidth: 0 }}>
              <div className="h-display" style={{ fontSize: 22, lineHeight: 1.1 }}>{data.display_name}</div>
              {r?.prize && (
                <div className="mono" style={{ color: "var(--gold)", fontWeight: 700, marginTop: 4, fontSize: 14 }}>
                  {fmtRub(r.prize.amount)}
                </div>
              )}
            </div>
          </div>
          <span className={`lb-pts ${(r?.total_points ?? 0) === 0 ? "zero" : ""}`} style={{ fontSize: 30 }}>
            {r?.total_points ?? 0}
          </span>
        </div>
        {r && (
          <div className="faint mt-12" style={{ fontSize: 12.5 }}>
            очки: матчи {fmtPts(r.match_points)} · бонусы {fmtPts(r.bonus_points)} · плей-офф {fmtPts(r.playoff_match_points)}
          </div>
        )}
      </div>

      <ParticipantBreakdown participantId={id} variant="full" />
    </div>
  );
}
