"use client";
import { use } from "react";
import useSWR from "swr";
import { useBootstrap } from "@/lib/client/bootstrap";
import { MatchBetCard } from "@/components/MatchBetCard";
import { TeamPill, StageBadge, Empty, CardSkeleton, BackLink } from "@/components/ui";
import { fmtMsk } from "@/lib/client/format";
import { ApiError } from "@/lib/client/api";
import type { ApiMatch, MyBet } from "@/lib/client/types";

interface DetailResp { match: ApiMatch; my_bet: MyBet | null }
interface RevealResp {
  match_id: string;
  deadline_at: string;
  bets: Array<{ participant_id: string; display_name: string; pred_home: number | null; pred_away: number | null; x2: boolean; pen_winner: string | null; points_earned: number | null }>;
}

export default function MatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: boot } = useBootstrap();
  const { data, isLoading, mutate } = useSWR<DetailResp>(`/matches/${id}`);
  const { data: reveal, error: revealErr } = useSWR<RevealResp>(boot?.participant ? `/matches/${id}/bets` : null);

  if (isLoading) return <div style={{ paddingTop: 24 }}><CardSkeleton count={1} /></div>;
  if (!data?.match) return <div style={{ paddingTop: 24 }}><Empty title="Матч не найден" /></div>;

  const m = data.match;
  const revealLocked = revealErr instanceof ApiError && revealErr.code === "REVEAL_BEFORE_DEADLINE";

  return (
    <div className="rise" style={{ paddingTop: 8 }}>
      <BackLink href="/matches" label="К матчам" />

      <div className="row gap-8 mt-8">
        <StageBadge stage={m.stage} group={m.group_code} />
        <span className="chip faint mono">матч №{m.fifa_match_no}</span>
      </div>

      {/* Result banner */}
      {m.result && (
        <div className="card card-pad mt-12 center">
          <div className="eyebrow">Результат</div>
          <div className="row" style={{ justifyContent: "center", gap: 18, marginTop: 8, alignItems: "center" }}>
            <TeamPill team={m.home_team} slot={m.home_slot} />
            <span className="h-display" style={{ fontSize: 40 }}>{m.result.toto_home}:{m.result.toto_away}</span>
            <TeamPill team={m.away_team} slot={m.away_slot} align="right" />
          </div>
          <div className="faint mono mt-8" style={{ fontSize: 12 }}>
            {m.result.result_status}
            {m.result.pen_home != null && ` · пенальти ${m.result.pen_home}:${m.result.pen_away}`}
          </div>
        </div>
      )}

      {/* Bet editor (only meaningful if open) */}
      {boot?.participant && (
        <div className="mt-16">
          <MatchBetCard match={m} myBet={data.my_bet} onSaved={() => mutate()} detailsLink={false} />
        </div>
      )}

      {/* Reveal */}
      <h2 className="section-title mt-24" style={{ fontSize: 18 }}>Прогнозы участников</h2>
      {revealLocked && (
        <div className="banner warn mt-12">
          Прогнозы участников откроются после дедлайна — {fmtMsk(m.deadline_at)} МСК.
        </div>
      )}
      {reveal && (
        <div className="card mt-12">
          {reveal.bets.map((b) => (
            <div key={b.participant_id} className="lb-row" style={{ gridTemplateColumns: "1fr auto auto", gap: 10 }}>
              <span className="lb-name">{b.display_name}</span>
              <span className="mono" style={{ fontSize: 16, color: b.pred_home == null ? "var(--ink-faint)" : "var(--ink)" }}>
                {b.pred_home == null ? "—" : `${b.pred_home}:${b.pred_away}`}
                {b.x2 && <span style={{ color: "var(--gold)" }}> ×2</span>}
              </span>
              <span className="lb-pts" style={{ fontSize: 18, minWidth: 34, textAlign: "right" }}>
                {b.points_earned == null ? "·" : b.points_earned}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
