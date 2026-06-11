"use client";
// Game-day calendar: a horizontally scrollable strip of match days (MSK) with
// the selected day's matches below. Self-contained (fetches /matches and the
// user's bets itself; SWR dedupes against other consumers), so it drops into
// both the home page and /matches. Defaults to today or the nearest game day.
import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { useBootstrap } from "@/lib/client/bootstrap";
import { MatchBetCard } from "./MatchBetCard";
import { CardSkeleton, Empty } from "./ui";
import { fmtDayKey, fmtDayNum, fmtDow, fmtMonthShort, mskDateKey, plural, todayMskKey } from "@/lib/client/format";
import type { ApiMatch, MyBet } from "@/lib/client/types";

interface MatchesResp { matches: ApiMatch[] }
interface MyBetsResp { bets: Array<MyBet & { match_id: string }> }

interface Day {
  key: string; // "2026-06-11" (MSK)
  dow: string;
  num: string;
  month: string;
  items: ApiMatch[];
}

function buildDays(matches: ApiMatch[]): Day[] {
  const sorted = matches
    .filter((m) => m.kickoff_at)
    .sort((a, b) => (a.kickoff_at! < b.kickoff_at! ? -1 : a.kickoff_at! > b.kickoff_at! ? 1 : a.fifa_match_no - b.fifa_match_no));
  const map = new Map<string, ApiMatch[]>();
  for (const m of sorted) {
    const k = mskDateKey(m.kickoff_at!);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(m);
  }
  return [...map.entries()].map(([key, items]) => ({
    key,
    dow: fmtDow(items[0].kickoff_at!),
    num: fmtDayNum(items[0].kickoff_at!),
    month: fmtMonthShort(items[0].kickoff_at!),
    items,
  }));
}

export function MatchCalendar() {
  const { data: boot } = useBootstrap();
  const { data, isLoading } = useSWR<MatchesResp>("/matches");
  const { data: myBets, mutate: mutateBets } = useSWR<MyBetsResp>(boot?.participant ? "/me/match-bets" : null);

  const betByMatch = useMemo(() => {
    const m = new Map<string, MyBet>();
    for (const b of myBets?.bets ?? []) m.set(b.match_id, b as MyBet);
    return m;
  }, [myBets]);

  const days = useMemo(() => buildDays(data?.matches ?? []), [data]);
  const today = todayMskKey();
  // Today if it is a game day, otherwise the next game day; after the final —
  // the last one.
  const defaultKey = useMemo(() => {
    const upcoming = days.find((d) => d.key >= today);
    return (upcoming ?? days[days.length - 1])?.key ?? null;
  }, [days, today]);

  const [picked, setPicked] = useState<string | null>(null);
  const key = picked ?? defaultKey;
  const day = days.find((d) => d.key === key) ?? null;

  // Keep the active chip in view: jump on first paint, glide on user taps.
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!key) return;
    const el = stripRef.current?.querySelector<HTMLElement>(`[data-day="${key}"]`);
    el?.scrollIntoView({ inline: "center", block: "nearest", behavior: picked ? "smooth" : "auto" });
  }, [key, picked]);

  if (isLoading && !data) return <CardSkeleton count={2} />;
  if (days.length === 0) return <Empty title="Расписание уточняется" />;

  return (
    <div>
      <div className="daystrip" ref={stripRef}>
        {days.map((d) => (
          <button
            key={d.key}
            type="button"
            data-day={d.key}
            className={`daychip ${d.key === key ? "active" : ""} ${d.key === today ? "today" : ""}`}
            onClick={() => setPicked(d.key)}
            aria-pressed={d.key === key}
          >
            <span className="dow">{d.dow}</span>
            <span className="dnum">{d.num}</span>
            <span className="dmon">{d.month}</span>
          </button>
        ))}
      </div>

      {day && (
        <>
          <div className="row between" style={{ margin: "12px 2px 10px" }}>
            <span className="eyebrow">
              {day.key === today ? "Сегодня · " : ""}{fmtDayKey(day.items[0].kickoff_at)}
            </span>
            <span className="row gap-8">
              <span className="faint mono" style={{ fontSize: 11 }}>{plural(day.items.length, "матч", "матча", "матчей")}</span>
              {key !== defaultKey && (
                <button type="button" className="chip chip-open" style={{ cursor: "pointer" }} onClick={() => setPicked(null)}>
                  ↺ к ближайшим
                </button>
              )}
            </span>
          </div>
          <div className="stack gap-12">
            {day.items.map((m) => (
              <MatchBetCard key={m.id} match={m} myBet={betByMatch.get(m.id) ?? null} onSaved={() => mutateBets()} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
