"use client";
import { useMemo } from "react";
import Link from "next/link";
import useSWR from "swr";
import { useBootstrap } from "@/lib/client/bootstrap";
import { PageHead, Countdown, CardSkeleton, Empty } from "@/components/ui";
import { BonusCategoryCard, type TeamLite } from "@/components/BonusCategoryCard";
import { BONUS_META } from "@/lib/client/labels";
import type { ApiMatch, MyBonusBet } from "@/lib/client/types";

interface MatchesResp { matches: ApiMatch[] }
interface BonusResp { bonus_deadline_at: string; locked: boolean; bets: MyBonusBet[] }

export default function BonusPage() {
  const { data: boot } = useBootstrap();
  const { data: matchesResp } = useSWR<MatchesResp>("/matches");
  const { data: bonus, isLoading, mutate } = useSWR<BonusResp>(boot?.participant ? "/me/bonus-bets" : null);

  const teams: TeamLite[] = useMemo(() => {
    const map = new Map<string, TeamLite>();
    for (const m of matchesResp?.matches ?? []) {
      if (m.stage !== "GROUP") continue;
      for (const t of [m.home_team, m.away_team]) {
        if (t?.id && !map.has(t.id)) {
          map.set(t.id, { id: t.id, code: t.code ?? "?", name_ru: t.name_ru ?? "?", group_code: m.group_code ?? "?" });
        }
      }
    }
    return [...map.values()];
  }, [matchesResp]);

  const existing = useMemo(() => {
    const m = new Map<string, { teamIds: string[]; player: string }>();
    for (const b of bonus?.bets ?? []) {
      const teamIds = b.items.filter((i) => i.team_id).map((i) => i.team_id!);
      const player = b.items.find((i) => i.player_name)?.player_name ?? "";
      m.set(b.category_id, { teamIds, player });
    }
    return m;
  }, [bonus]);

  if (!boot?.participant) {
    return (
      <div style={{ paddingTop: 40 }}>
        <Empty title="Нужно войти" sub="Авторизуйтесь, чтобы заполнить бонусы." />
        <Link href="/" className="btn btn-primary btn-block mt-16">На главную</Link>
      </div>
    );
  }

  const locked = bonus?.locked ?? boot.deadlines.bonus_locked;

  return (
    <div>
      <PageHead
        eyebrow="7 категорий · разовый дедлайн"
        title="Бонусы"
        right={locked ? <span className="chip chip-locked">Закрыто</span> : <Countdown target={boot.deadlines.bonus_deadline_at} />}
      />

      {locked ? (
        <div className="banner warn">
          Приём бонусов закрыт (10 июня, 23:00 МСК). Прогнозы зафиксированы и раскрыты для всех.{" "}
          <Link href="/reveal/bonus" style={{ color: "var(--coral)", textDecoration: "underline" }}>Посмотреть все</Link>
        </div>
      ) : (
        <div className="banner">
          Выберите команды в каждой категории. Дубликаты внутри категории запрещены, нужно ровно нужное
          количество. После дедлайна изменить будет нельзя.
        </div>
      )}

      <div className="stack gap-12 mt-16">
        {isLoading && <CardSkeleton count={7} />}
        {!isLoading &&
          BONUS_META.map((meta) => {
            const init = existing.get(meta.id) ?? { teamIds: [], player: "" };
            return (
              <BonusCategoryCard
                key={meta.id}
                meta={meta}
                teams={teams}
                initialTeamIds={init.teamIds}
                initialPlayer={init.player}
                locked={locked}
                onSaved={() => mutate()}
              />
            );
          })}
      </div>
    </div>
  );
}
