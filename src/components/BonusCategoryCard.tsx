"use client";
import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { useToast } from "./Toast";
import { IconCheck, IconChevron, IconLock } from "./icons";
import { flag } from "@/lib/client/flags";
import type { BonusMeta } from "@/lib/client/labels";

export interface TeamLite {
  id: string;
  code: string;
  name_ru: string;
  group_code: string;
}

interface Props {
  meta: BonusMeta;
  teams: TeamLite[];
  initialTeamIds: string[];
  initialPlayer: string;
  locked: boolean;
  onSaved: () => void;
}

export function BonusCategoryCard({ meta, teams, initialTeamIds, initialPlayer, locked, onSaved }: Props) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set(initialTeamIds));
  const [player, setPlayer] = useState(initialPlayer);
  const [saving, setSaving] = useState(false);

  const isTeam = meta.itemType === "TEAM";

  // Re-sync from props when the saved bet changes (first load arriving after
  // mount, or another device's save). Skip while the editor is open so the
  // user's in-progress picks survive. Keyed on content, not array identity, so
  // a fresh `initialTeamIds` array each parent render doesn't reset us.
  useEffect(() => {
    if (open) return;
    setSelected(new Set(initialTeamIds));
    setPlayer(initialPlayer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isTeam ? [...initialTeamIds].sort().join(",") : initialPlayer]);

  const count = isTeam ? selected.size : player.trim() ? 1 : 0;
  const complete = count === meta.itemCount;
  const dirty = isTeam
    ? !sameSet(selected, new Set(initialTeamIds))
    : player.trim() !== initialPlayer.trim();

  const byGroup = useMemo(() => {
    const m = new Map<string, TeamLite[]>();
    for (const t of teams) {
      if (!m.has(t.group_code)) m.set(t.group_code, []);
      m.get(t.group_code)!.push(t);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [teams]);

  const teamOf = (id: string) => teams.find((t) => t.id === id);

  // "Победители групп": exactly one winner per group — selecting another team in
  // the same group replaces the previous pick (radio-per-group behaviour).
  const onePerGroup = meta.id === "GROUP_WINNER";
  // At most 3 teams leave any group (1st, 2nd and possibly the 3rd-placed), so
  // they cap the 1/8, 1/4 and 1/2 participant picks at 3 per group.
  const maxPerGroup = ["R16_PARTICIPANT", "QF_PARTICIPANT", "SF_PARTICIPANT"].includes(meta.id) ? 3 : null;
  const groupOf = (id: string) => teams.find((t) => t.id === id)?.group_code;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        return next;
      }
      if (onePerGroup) {
        const group = groupOf(id);
        for (const sid of [...next]) if (groupOf(sid) === group) next.delete(sid);
        next.add(id);
        return next;
      }
      if (maxPerGroup) {
        const group = groupOf(id);
        const inGroup = [...next].filter((sid) => groupOf(sid) === group).length;
        if (inGroup >= maxPerGroup) {
          toast(`Из группы максимум ${maxPerGroup} команды`, "err");
          return next;
        }
      }
      if (next.size < meta.itemCount) next.add(id);
      else toast(`Можно выбрать только ${meta.itemCount}`, "err");
      return next;
    });
  }

  async function save() {
    setSaving(true);
    try {
      const items = isTeam ? [...selected].map((id) => ({ team_id: id })) : [{ player_name: player.trim() }];
      await api.put("/me/bonus-bets", { categories: [{ category_id: meta.id, items }] });
      toast(`«${meta.nameRu}» сохранено`, "ok");
      onSaved();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Ошибка", "err");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <button
        className="card-pad row between"
        style={{ width: "100%", background: "transparent", border: "none", textAlign: "left", cursor: locked ? "default" : "pointer" }}
        onClick={() => !locked && setOpen((v) => !v)}
      >
        <div>
          <div className="section-title" style={{ fontSize: 16 }}>{meta.nameRu}</div>
          <div className="faint" style={{ fontSize: 12, marginTop: 3 }}>
            {meta.hint} · {meta.pointsPerCorrect} очк./шт
          </div>
        </div>
        <div className="row gap-8">
          <span className={`chip ${complete ? "chip-open" : ""}`}>
            {complete && <IconCheck width={12} height={12} />} {count}/{meta.itemCount}
          </span>
          {locked ? <IconLock width={16} height={16} style={{ color: "var(--ink-faint)" }} /> : (
            <IconChevron width={16} height={16} style={{ color: "var(--ink-faint)", transform: open ? "rotate(90deg)" : "none", transition: "transform .2s" }} />
          )}
        </div>
      </button>

      {/* Locked summary */}
      {locked && (
        <div className="card-pad" style={{ paddingTop: 0 }}>
          <div className="row wrap gap-6">
            {isTeam
              ? [...selected].map((id) => (
                  <span key={id} className="chip">
                    <span className="tflag" style={{ fontSize: 14 }}>{flag(teamOf(id)?.code)}</span>
                    {teamOf(id)?.name_ru ?? "?"}
                  </span>
                ))
              : player
                ? <span className="chip">{player}</span>
                : <span className="faint" style={{ fontSize: 13 }}>не заполнено</span>}
          </div>
        </div>
      )}

      {/* Editor */}
      {open && !locked && (
        <div className="card-pad rise" style={{ paddingTop: 0 }}>
          {isTeam ? (
            <div className="stack gap-12">
              {onePerGroup && (
                <div className="faint" style={{ fontSize: 12 }}>По одной команде из каждой группы.</div>
              )}
              {maxPerGroup && (
                <div className="faint" style={{ fontSize: 12 }}>Из каждой группы максимум {maxPerGroup} команды.</div>
              )}
              {byGroup.map(([g, ts]) => (
                <div key={g}>
                  <div className="eyebrow" style={{ marginBottom: 6 }}>Группа {g}</div>
                  <div className="row wrap gap-6">
                    {ts.map((t) => {
                      const on = selected.has(t.id);
                      return (
                        <button
                          key={t.id}
                          onClick={() => toggle(t.id)}
                          className="chip"
                          style={{
                            cursor: "pointer",
                            borderColor: on ? "var(--pitch)" : undefined,
                            background: on ? "var(--pitch-soft)" : undefined,
                            color: on ? "var(--pitch)" : undefined,
                          }}
                        >
                          <span className="tflag" style={{ fontSize: 14 }}>{flag(t.code)}</span>
                          {t.name_ru}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <input
              className="input"
              placeholder="Например: Килиан Мбаппе"
              value={player}
              onChange={(e) => setPlayer(e.target.value)}
            />
          )}

          <button className="btn btn-primary btn-block mt-16" disabled={!complete || !dirty || saving} onClick={save}>
            {saving ? "…" : complete ? "Сохранить" : `Выберите ${meta.itemCount}`}
          </button>
        </div>
      )}
    </div>
  );
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}
