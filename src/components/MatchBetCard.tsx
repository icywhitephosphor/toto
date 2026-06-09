"use client";
import { useMemo, useState } from "react";
import { api, ApiError, uuid } from "@/lib/client/api";
import { useServerClock } from "@/lib/client/hooks";
import { countdown, fmtMsk } from "@/lib/client/format";
import { useToast } from "./Toast";
import { StageBadge, Countdown } from "./ui";
import type { ApiMatch, MyBet, ApiTeam } from "@/lib/client/types";

const clampScore = (s: string) => Math.max(0, Math.min(20, parseInt(s.replace(/\D/g, ""), 10) || 0));

interface SaveResult {
  saved: Array<{ match_id: string; status: string; version: number }>;
  rejected: Array<{ match_id: string; status: string; reason?: string; deadline_at?: string }>;
}

function reconstructReg(bet: MyBet | null | undefined): { h: number; a: number; pen: "HOME" | "AWAY" | null } {
  if (!bet) return { h: 0, a: 0, pen: null };
  if (bet.pen_winner) {
    return {
      h: bet.pred_home - (bet.pen_winner === "HOME" ? 1 : 0),
      a: bet.pred_away - (bet.pen_winner === "AWAY" ? 1 : 0),
      pen: bet.pen_winner,
    };
  }
  return { h: bet.pred_home, a: bet.pred_away, pen: null };
}

function Stepper({ value, set, disabled }: { value: number; set: (n: number) => void; disabled: boolean }) {
  return (
    <div className="stepper">
      <button type="button" disabled={disabled || value <= 0} onClick={() => set(Math.max(0, value - 1))} aria-label="−">−</button>
      <button type="button" disabled={disabled || value >= 20} onClick={() => set(Math.min(20, value + 1))} aria-label="+">+</button>
    </div>
  );
}

// One side of the scoreboard: team label, a tap-to-type numeric field (native
// phone keypad), and a small +/- nudge. Locked/TBD matches show a static digit.
function ScoreField({
  team,
  slot,
  value,
  set,
  saving,
  locked,
  notOpen,
}: {
  team: ApiTeam | null;
  slot: string | null;
  value: number;
  set: (n: number) => void;
  saving: boolean;
  locked: boolean;
  notOpen: boolean;
}) {
  return (
    <div className="score-cell">
      <span className="score-team">
        <span className="flag">{team?.code ?? "?"}</span>
        <span className="tname">{team?.name_ru ?? slot ?? "TBD"}</span>
      </span>
      {locked || notOpen ? (
        <div className="score-box"><span className="score-digit">{notOpen ? "–" : value}</span></div>
      ) : (
        <input
          className="score-input"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={2}
          value={String(value)}
          disabled={saving}
          aria-label={`Голы: ${team?.name_ru ?? "команда"}`}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => set(clampScore(e.target.value))}
        />
      )}
      {!locked && !notOpen && <Stepper value={value} set={set} disabled={saving} />}
    </div>
  );
}

export function MatchBetCard({ match, myBet, onSaved }: { match: ApiMatch; myBet?: MyBet | null; onSaved?: () => void }) {
  const toast = useToast();
  const now = useServerClock(1000);
  const init = useMemo(() => reconstructReg(myBet), [myBet]);

  const [h, setH] = useState(init.h);
  const [a, setA] = useState(init.a);
  const [x2, setX2] = useState(myBet?.x2 ?? false);
  const [pen, setPen] = useState<"HOME" | "AWAY" | null>(init.pen);
  const [saving, setSaving] = useState(false);

  const notOpen = match.deadline_at === null;
  const locked = notOpen || countdown(match.deadline_at, now).locked;
  const isDraw = h === a;
  const needsPen = match.x2_allowed && isDraw;

  const dirty =
    h !== init.h || a !== init.a || x2 !== (myBet?.x2 ?? false) || (needsPen && pen !== init.pen);
  const hasBet = !!myBet;

  async function save() {
    if (needsPen && !pen) {
      toast("Выберите, кто проходит по пенальти", "err");
      return;
    }
    setSaving(true);
    try {
      const res = await api.put<SaveResult>("/me/match-bets", {
        idempotency_key: uuid(),
        bets: [{ match_id: match.id, pred_home: h, pred_away: a, x2, pen_winner: needsPen ? pen : null }],
      });
      if (res.saved.some((s) => s.match_id === match.id)) {
        toast("Прогноз сохранён", "ok");
        onSaved?.();
      } else {
        const r = res.rejected.find((x) => x.match_id === match.id);
        toast(r?.reason ?? "Не удалось сохранить", "err");
        onSaved?.();
      }
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Ошибка сети", "err");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card card-pad rise">
      <div className="row between gap-8">
        <div className="row gap-8">
          <StageBadge stage={match.stage} group={match.group_code} />
          <span className="chip faint mono">{fmtMsk(match.kickoff_at)}</span>
        </div>
        {notOpen ? <span className="chip chip-locked">Жеребьёвка</span> : <Countdown target={match.deadline_at} />}
      </div>

      <div className="scoreboard mt-16">
        <ScoreField team={match.home_team} slot={match.home_slot} value={h} set={setH} saving={saving} locked={locked} notOpen={notOpen} />
        <span className="score-colon">:</span>
        <ScoreField team={match.away_team} slot={match.away_slot} value={a} set={setA} saving={saving} locked={locked} notOpen={notOpen} />
      </div>

      {match.x2_allowed && needsPen && !locked && (
        <div className="mt-12 stack gap-6">
          <div className="eyebrow">Ничья — кто проходит по пенальти?</div>
          <div className="segmented">
            <button className={`seg ${pen === "HOME" ? "active" : ""}`} onClick={() => setPen("HOME")}>{match.home_team?.name_ru ?? "Хозяева"}</button>
            <button className={`seg ${pen === "AWAY" ? "active" : ""}`} onClick={() => setPen("AWAY")}>{match.away_team?.name_ru ?? "Гости"}</button>
          </div>
        </div>
      )}

      <div className="row between mt-16 gap-12">
        {match.x2_allowed && !locked ? (
          <button type="button" className={`x2 ${x2 ? "on" : ""}`} onClick={() => setX2((v) => !v)} aria-pressed={x2}>
            <span className="x2-label">×2</span>
            <span className="x2-track"><span className="x2-knob" /></span>
          </button>
        ) : (
          <span className="faint" style={{ fontSize: 12 }}>
            {match.venue ? `${match.venue}${match.city ? ", " + match.city : ""}` : " "}
          </span>
        )}

        {locked ? (
          <span className="chip chip-locked">{hasBet ? `Ставка: ${myBet!.pred_home}:${myBet!.pred_away}` : "Без ставки"}</span>
        ) : (
          <button className="btn btn-primary btn-sm" disabled={!dirty || saving} onClick={save}>
            {saving ? "…" : dirty ? "Сохранить" : hasBet ? "Сохранено" : "Ставка"}
          </button>
        )}
      </div>
    </div>
  );
}
