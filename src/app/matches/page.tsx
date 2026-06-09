"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { useBootstrap } from "@/lib/client/bootstrap";
import { MatchBetCard } from "@/components/MatchBetCard";
import { PageHead, CardSkeleton, Empty } from "@/components/ui";
import { fmtDayKey } from "@/lib/client/format";
import { STAGE_LABEL } from "@/components/ui";
import type { ApiMatch, MyBet, Stage } from "@/lib/client/types";

interface MatchesResp { matches: ApiMatch[] }
interface MyBetsResp { bets: Array<MyBet & { match_id: string }> }

const FILTERS: Array<{ key: string; label: string; stages: Stage[] }> = [
  { key: "group", label: "Группа", stages: ["GROUP"] },
  { key: "po", label: "Плей-офф", stages: ["R32", "R16", "QF", "SF", "THIRD", "FINAL"] },
];

export default function MatchesPage() {
  const { data: boot } = useBootstrap();
  const [filter, setFilter] = useState("group");
  const { data, isLoading } = useSWR<MatchesResp>("/matches");
  const { data: myBets, mutate: mutateBets } = useSWR<MyBetsResp>(
    boot?.participant ? "/me/match-bets" : null,
  );

  const betByMatch = useMemo(() => {
    const m = new Map<string, MyBet>();
    for (const b of myBets?.bets ?? []) m.set(b.match_id, b as MyBet);
    return m;
  }, [myBets]);

  const active = FILTERS.find((f) => f.key === filter)!;
  const list = (data?.matches ?? []).filter((m) => active.stages.includes(m.stage));

  // Group group-stage matches by day; knockout grouped by stage.
  const groups = useMemo(() => groupMatches(list, filter), [list, filter]);

  if (!boot?.participant) return <NeedLogin />;

  return (
    <div>
      <PageHead eyebrow="104 матча · 21 участник" title="Матчи" />

      <div className="segmented" style={{ marginBottom: 16 }}>
        {FILTERS.map((f) => (
          <button key={f.key} className={`seg ${filter === f.key ? "active" : ""}`} onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>

      {isLoading && <CardSkeleton />}
      {!isLoading && list.length === 0 && <Empty title="Нет матчей" />}

      <div className="stack gap-24">
        {groups.map((g) => (
          <section key={g.title}>
            <div className="row between" style={{ marginBottom: 10 }}>
              <h2 className="section-title" style={{ fontSize: 16, color: "var(--ink-dim)" }}>{g.title}</h2>
              <span className="faint mono" style={{ fontSize: 11 }}>{g.items.length}</span>
            </div>
            <div className="stack gap-12">
              {g.items.map((m) => (
                <MatchBetCard key={m.id} match={m} myBet={betByMatch.get(m.id) ?? null} onSaved={() => mutateBets()} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function groupMatches(list: ApiMatch[], filter: string): Array<{ title: string; items: ApiMatch[] }> {
  const sorted = [...list].sort((a, b) => a.fifa_match_no - b.fifa_match_no);
  const map = new Map<string, ApiMatch[]>();
  for (const m of sorted) {
    const key = filter === "group" && m.kickoff_at ? fmtDayKey(m.kickoff_at) : STAGE_LABEL[m.stage];
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(m);
  }
  return [...map.entries()].map(([title, items]) => ({ title, items }));
}

function NeedLogin() {
  return (
    <div style={{ paddingTop: 40 }}>
      <Empty title="Нужно войти" sub="Авторизуйтесь и выберите своё имя, чтобы делать ставки." />
      <Link href="/" className="btn btn-primary btn-block mt-16">На главную</Link>
    </div>
  );
}
