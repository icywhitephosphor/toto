"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, ApiError, uuid } from "@/lib/client/api";
import { useServerClock } from "@/lib/client/hooks";
import { countdown, fmtMsk } from "@/lib/client/format";
import { useToast } from "./Toast";
import { StageBadge, Countdown, slotLabel } from "./ui";
import { flag } from "@/lib/client/flags";
import { pointsClass, fmtPts } from "@/lib/client/points";
import type { ApiMatch, MyBet, ApiTeam } from "@/lib/client/types";

const clampScore = (s: string) => Math.max(0, Math.min(20, parseInt(s.replace(/\D/g, ""), 10) || 0));

interface SaveResult {
  saved: Array<{ match_id: string; status: string; version: number }>;
  rejected: Array<{ match_id: string; status: string; reason?: string; deadline_at?: string }>;
}

// Play-off predictions are stored as the decisive score (the win is encoded in
// the scoreline itself), so the saved bet maps straight to the inputs.
function reconstructReg(bet: MyBet | null | undefined): { h: number; a: number } {
  if (!bet) return { h: 0, a: 0 };
  return { h: bet.pred_home, a: bet.pred_away };
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
// phone keypad) plus a small +/- nudge when editable; otherwise a static digit.
function ScoreField({
  team,
  projected,
  slot,
  value,
  set,
  saving,
  editable,
  notOpen,
}: {
  team: ApiTeam | null;
  projected?: ApiTeam | null;
  slot: string | null;
  value: number;
  set: (n: number) => void;
  saving: boolean;
  editable: boolean;
  notOpen: boolean;
}) {
  return (
    <div className="score-cell">
      {team ? (
        <span className="score-team">
          <span className="tflag">{flag(team.code)}</span>
          <span className="tname">{team.name_ru}</span>
        </span>
      ) : projected ? (
        // The slot is not decided yet — show who holds it per the live tables.
        <span className="score-team proj">
          <span className="tflag">{flag(projected.code)}</span>
          <span className="tname">≈ {projected.name_ru}</span>
        </span>
      ) : (
        <span className="score-team">
          <span className="tname slot">{slotLabel(slot) ?? "Уточняется"}</span>
        </span>
      )}
      {editable ? (
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
      ) : (
        <div className="score-box"><span className="score-digit">{notOpen ? "–" : value}</span></div>
      )}
      {editable && <Stepper value={value} set={set} disabled={saving} />}
    </div>
  );
}

export function MatchBetCard({ match, myBet, onSaved, detailsLink = true }: { match: ApiMatch; myBet?: MyBet | null; onSaved?: () => void; detailsLink?: boolean }) {
  const toast = useToast();
  const now = useServerClock(1000);
  const init = useMemo(() => reconstructReg(myBet), [myBet]);

  const [h, setH] = useState(init.h);
  const [a, setA] = useState(init.a);
  const [x2, setX2] = useState(myBet?.x2 ?? false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  // Re-sync inputs when the saved bet changes underneath us — first load
  // arriving after mount, or an SWR revalidation. Never while the user is
  // mid-edit, so we don't clobber what they're typing.
  useEffect(() => {
    if (editing) return;
    setH(init.h);
    setA(init.a);
    setX2(myBet?.x2 ?? false);
  }, [init, myBet, editing]);

  const notOpen = match.deadline_at === null;
  const locked = notOpen || countdown(match.deadline_at, now).locked;
  const res = match.result;
  const finished = !!res && ["FT", "AET", "PEN"].includes(res.result_status);
  const liveScore = res?.result_status === "LIVE" ? res : null;
  const kickoffPassed = match.kickoff_at != null && now >= new Date(match.kickoff_at).getTime();
  const inPlay = !notOpen && kickoffPassed && !finished && match.status !== "CANCELLED";
  // Once a score exists (live or final) the big digits show IT, not the bet —
  // the bet moves to a chip below with the points earned.
  const showScore = finished || liveScore != null;
  const scoreH = showScore ? (res!.toto_home ?? 0) : h;
  const scoreA = showScore ? (res!.toto_away ?? 0) : a;
  const isDraw = h === a;
  // Play-off results are always decisive (the shootout folds into "+1 goal"),
  // so a drawn play-off prediction can never score — block it on the spot.
  const isPlayoffDraw = match.x2_allowed && isDraw;
  const hasBet = !!myBet;

  // Editor shows when placing a first bet, or after pressing "Изменить ставку".
  const showEditor = !locked && (editing || !hasBet);
  const dirty = h !== init.h || a !== init.a || x2 !== (myBet?.x2 ?? false);
  const canSave = showEditor && !saving && !isPlayoffDraw && (!hasBet || dirty);

  function resetToSaved() {
    setH(init.h);
    setA(init.a);
    setX2(myBet?.x2 ?? false);
  }

  async function save() {
    if (isPlayoffDraw) {
      toast("В плей-офф нужен победитель — ничья невозможна", "err");
      return;
    }
    setSaving(true);
    try {
      const res = await api.put<SaveResult>("/me/match-bets", {
        idempotency_key: uuid(),
        bets: [{ match_id: match.id, pred_home: h, pred_away: a, x2 }],
      });
      if (res.saved.some((s) => s.match_id === match.id)) {
        toast("Прогноз сохранён", "ok");
        setEditing(false);
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
      {/* One chip row: stage · kickoff · state. Finished/live cards keep all
          three on a single line; upcoming cards show the two countdowns below. */}
      <div className="row wrap gap-6">
        <StageBadge stage={match.stage} group={match.group_code} />
        {match.kickoff_at && <span className="chip faint mono">{fmtMsk(match.kickoff_at)}</span>}
        {notOpen ? (
          <span className="chip chip-locked">Ждём участников</span>
        ) : finished ? (
          <span className="chip chip-open">✓ Завершён{res!.result_status !== "FT" ? ` · ${res!.result_status === "PEN" ? "по пенальти" : "в доп. время"}` : ""}</span>
        ) : inPlay ? (
          <span className="chip chip-live"><span className="dot" /> Матч идёт{liveScore ? ` · ${liveScore.toto_home}:${liveScore.toto_away}` : ""}</span>
        ) : null}
      </div>

      {/* Two distinct countdowns until kickoff: betting deadline (−3h group,
          −2h play-off), then the match itself — different colours so they're
          never confused. */}
      {!notOpen && !finished && !inPlay && (
        <div className="cd-row mt-12">
          <Countdown target={match.deadline_at} label="Приём ставок" tone="deadline" lockedLabel="Приём закрыт" />
          <Countdown target={match.kickoff_at} label="До матча" tone="kickoff" lockedLabel="Матч идёт" />
        </div>
      )}

      <div className="scoreboard mt-16">
        <ScoreField team={match.home_team} projected={match.projected_home} slot={match.home_slot} value={showEditor ? h : scoreH} set={setH} saving={saving} editable={showEditor} notOpen={notOpen} />
        <span className="score-colon">:</span>
        <ScoreField team={match.away_team} projected={match.projected_away} slot={match.away_slot} value={showEditor ? a : scoreA} set={setA} saving={saving} editable={showEditor} notOpen={notOpen} />
      </div>

      {showEditor && isPlayoffDraw && (
        <div className="mt-12" style={{ fontSize: 12.5, color: "var(--coral)" }}>
          В плей-офф не бывает ничьих — добавьте гол команде, которая проходит дальше.
          Серию пенальти указывать не нужно: счёт 3:2 сработает и за победу в основное время, и за 2:2 + пенальти.
        </div>
      )}

      {notOpen ? (
        <div className="row mt-16" style={{ justifyContent: "center" }}>
          <span className="faint" style={{ fontSize: 12 }}>
            Ставки откроются, когда определятся участники
          </span>
        </div>
      ) : (
      <div className="row between mt-16 gap-12" style={{ minHeight: 38 }}>
        {showEditor && match.x2_allowed ? (
          <button type="button" className={`x2 ${x2 ? "on" : ""}`} onClick={() => setX2((v) => !v)} aria-pressed={x2}>
            <span className="x2-label">×2</span>
            <span className="x2-track"><span className="x2-knob" /></span>
          </button>
        ) : !showEditor && hasBet && !locked ? (
          <span className="chip chip-open">✓ Сохранено{myBet!.x2 ? " · ×2" : ""}</span>
        ) : locked && hasBet && myBet!.x2 ? (
          <span className="row gap-6">
            <span className="chip">×2</span>
          </span>
        ) : (
          <span className="faint" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {match.venue ? `${match.venue}${match.city ? ", " + match.city : ""}` : " "}
          </span>
        )}

        {locked ? (
          (() => {
            const scored = finished && hasBet && myBet?.points != null;
            const cls = scored
              ? pointsClass(myBet!.points!, {
                  exact: myBet!.pred_home === res!.toto_home && myBet!.pred_away === res!.toto_away,
                  x2: myBet!.x2,
                })
              : "chip-locked";
            return (
              <span className="row gap-6">
                <span className={`chip ${cls}`}>{hasBet ? `Моя ставка ${init.h}:${init.a}` : "Без ставки"}</span>
                {scored && <span className={`chip ${cls}`}>{fmtPts(myBet!.points!)} очк.</span>}
              </span>
            );
          })()
        ) : showEditor ? (
          <div className="row gap-8">
            {hasBet && (
              <button className="btn btn-ghost btn-sm" disabled={saving} onClick={() => { resetToSaved(); setEditing(false); }}>
                Отмена
              </button>
            )}
            <button className="btn btn-primary btn-sm" disabled={!canSave} onClick={save}>
              {saving ? "…" : "Сохранить"}
            </button>
          </div>
        ) : (
          <button className="btn btn-sm" onClick={() => { resetToSaved(); setEditing(true); }}>
            Изменить ставку
          </button>
        )}
      </div>
      )}

      {/* After the deadline everyone's predictions are public (fairness rule) —
          surface that right on the card. */}
      {locked && !notOpen && detailsLink && (
        <Link href={`/match/${match.id}`} className="btn btn-ghost btn-sm btn-block mt-12">
          Прогнозы участников{match.result ? " и очки" : ""}
        </Link>
      )}
    </div>
  );
}
