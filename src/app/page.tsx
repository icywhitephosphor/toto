"use client";
import Link from "next/link";
import useSWR from "swr";
import { useBootstrap } from "@/lib/client/bootstrap";
import { LoginScreen } from "@/components/LoginScreen";
import { ClaimScreen } from "@/components/ClaimScreen";
import { Countdown } from "@/components/ui";
import { IconChevron, IconBonus, IconMatches, IconTable } from "@/components/icons";
import { fmtRub } from "@/lib/client/format";
import type { Leaderboard } from "@/lib/client/types";

export default function Home() {
  const { data, isLoading } = useBootstrap();

  if (isLoading && !data) {
    return (
      <div className="stack gap-12" style={{ paddingTop: 18 }}>
        <div className="skel" style={{ height: 220 }} />
        <div className="skel" style={{ height: 120 }} />
      </div>
    );
  }
  if (!data?.user) return <LoginScreen />;
  if (!data.participant) return <ClaimScreen />;
  return <Hub />;
}

function Hub() {
  const { data } = useBootstrap();
  const { data: lb } = useSWR<Leaderboard>("/leaderboard", { refreshInterval: 30000 });
  const me = data?.participant;
  const dl = data?.deadlines;
  const firstName = me?.display_name?.split(" ")[1] ?? data?.user?.first_name ?? "друг";

  const myRow = lb?.rows.find((r) => r.participant_id === me?.id);
  const top3 = lb?.rows.slice(0, 3) ?? [];

  return (
    <div className="rise" style={{ paddingTop: 6 }}>
      <div className="eyebrow">С возвращением</div>
      <h1 className="h-display" style={{ fontSize: 32, marginTop: 4 }}>
        Привет, {firstName}!
      </h1>

      {/* Status cards */}
      <div className="stack gap-12 mt-16">
        <Link href="/bonus" className="card card-pad row between" style={{ alignItems: "center" }}>
          <div className="row gap-12">
            <div style={{ color: "var(--gold)" }}><IconBonus width={26} height={26} /></div>
            <div>
              <div className="section-title" style={{ fontSize: 17 }}>Бонусы</div>
              <div className="faint" style={{ fontSize: 12, marginTop: 2 }}>
                {dl?.bonus_locked ? "Приём закрыт — ставки раскрыты" : "Дедлайн 10 июня, 23:00 МСК"}
              </div>
            </div>
          </div>
          <div className="row gap-8">
            {!dl?.bonus_locked && <Countdown target={dl?.bonus_deadline_at ?? null} />}
            <IconChevron width={18} height={18} style={{ color: "var(--ink-faint)" }} />
          </div>
        </Link>

        <Link href="/matches" className="card card-pad row between" style={{ alignItems: "center" }}>
          <div className="row gap-12">
            <div style={{ color: "var(--pitch)" }}><IconMatches width={26} height={26} /></div>
            <div>
              <div className="section-title" style={{ fontSize: 17 }}>Ближайший матч</div>
              <div className="faint" style={{ fontSize: 12, marginTop: 2 }}>
                {dl?.next_match_deadline_at ? "До закрытия приёма ставок" : "Расписание уточняется"}
              </div>
            </div>
          </div>
          <div className="row gap-8">
            {dl?.next_match_deadline_at && <Countdown target={dl.next_match_deadline_at} />}
            <IconChevron width={18} height={18} style={{ color: "var(--ink-faint)" }} />
          </div>
        </Link>
      </div>

      {/* Your standing */}
      <div className="card card-pad mt-16">
        <div className="row between">
          <div className="eyebrow">Ваше место</div>
          <Link href="/leaderboard" className="chip chip-open"><IconTable width={12} height={12} /> таблица</Link>
        </div>
        <div className="row between mt-12" style={{ alignItems: "baseline" }}>
          <div className="row gap-12" style={{ alignItems: "baseline" }}>
            <span className="h-display" style={{ fontSize: 46, color: "var(--pitch)" }}>
              {myRow ? `#${myRow.place}` : "—"}
            </span>
            <span className="muted">{me?.display_name}</span>
          </div>
          <div className="center">
            <div className="lb-pts">{myRow?.total_points ?? 0}</div>
            <div className="eyebrow">очков</div>
          </div>
        </div>
        {myRow?.prize && myRow.total_points > 0 && (
          <div className="banner gold mt-12">🏆 Призовая зона: {myRow.prize.label} — {fmtRub(myRow.prize.amount)}</div>
        )}
      </div>

      {/* Podium preview */}
      {top3.length > 0 && (
        <div className="card mt-16">
          <div className="card-pad" style={{ paddingBottom: 4 }}>
            <div className="eyebrow">Лидеры</div>
          </div>
          {top3.map((r) => (
            <div key={r.participant_id} className={`lb-row p${r.place} ${r.participant_id === me?.id ? "me" : ""}`}>
              <span className="lb-place">{r.place}</span>
              <span className="lb-name">{r.display_name}</span>
              <span className={`lb-pts ${r.total_points === 0 ? "zero" : ""}`}>{r.total_points}</span>
            </div>
          ))}
        </div>
      )}

      <div className="faint center mt-24" style={{ fontSize: 11 }}>
        Источник истины — сервер. Дедлайны и секретность ставок проверяются на бэкенде.
      </div>
    </div>
  );
}
