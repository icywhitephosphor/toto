"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { useBootstrap } from "@/lib/client/bootstrap";
import { api, ApiError } from "@/lib/client/api";
import { useToast } from "@/components/Toast";
import { PageHead, Empty } from "@/components/ui";
import { STAGE_LABEL } from "@/components/ui";
import { BONUS_META } from "@/lib/client/labels";
import type { ApiMatch } from "@/lib/client/types";

interface MatchesResp { matches: ApiMatch[] }

export default function AdminPage() {
  const { data: boot } = useBootstrap();
  const [tab, setTab] = useState<"results" | "bonus" | "service">("results");

  if (boot && !boot.user?.is_admin) {
    return (
      <div style={{ paddingTop: 40 }}>
        <Empty title="Нет доступа" sub="Раздел только для администратора." />
        <Link href="/" className="btn btn-block mt-16">На главную</Link>
      </div>
    );
  }

  return (
    <div>
      <PageHead eyebrow="Только для организатора" title="Админка" />
      <div className="segmented" style={{ marginBottom: 16 }}>
        <button className={`seg ${tab === "results" ? "active" : ""}`} onClick={() => setTab("results")}>Результаты</button>
        <button className={`seg ${tab === "bonus" ? "active" : ""}`} onClick={() => setTab("bonus")}>Бонусы</button>
        <button className={`seg ${tab === "service" ? "active" : ""}`} onClick={() => setTab("service")}>Сервис</button>
      </div>
      {tab === "results" && <ResultsTab />}
      {tab === "bonus" && <BonusSettleTab />}
      {tab === "service" && <ServiceTab />}
    </div>
  );
}

function ResultsTab() {
  const toast = useToast();
  const { data, mutate } = useSWR<MatchesResp>("/matches");
  const [matchId, setMatchId] = useState("");
  const [home, setHome] = useState(0);
  const [away, setAway] = useState(0);
  const [penH, setPenH] = useState(0);
  const [penA, setPenA] = useState(0);
  const [status, setStatus] = useState("FT");
  const [busy, setBusy] = useState(false);

  const matches = data?.matches ?? [];
  const selected = matches.find((m) => m.id === matchId);
  const isPlayoff = selected?.x2_allowed ?? false;

  async function submit() {
    if (!selected) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = { base_home: home, base_away: away, result_status: status, source: "ADMIN", reason: "admin entry" };
      if (status === "PEN") {
        body.pen_home = penH;
        body.pen_away = penA;
      }
      const res = await api.patch<{ recompute_triggered: boolean }>(`/admin/matches/${selected.id}/result`, body);
      toast(res.recompute_triggered ? "Результат сохранён, пересчёт выполнен" : "Результат сохранён", "ok");
      mutate();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Ошибка", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack gap-12">
      <div className="card card-pad stack gap-12">
        <div className="eyebrow">Ввод результата</div>
        <select className="input" value={matchId} onChange={(e) => setMatchId(e.target.value)}>
          <option value="">— выберите матч —</option>
          {matches.map((m) => (
            <option key={m.id} value={m.id}>
              №{m.fifa_match_no} · {STAGE_LABEL[m.stage]} · {m.home_team?.name_ru ?? m.home_slot} — {m.away_team?.name_ru ?? m.away_slot}
            </option>
          ))}
        </select>

        {selected && (
          <>
            <div className="row gap-12" style={{ justifyContent: "center" }}>
              <NumberField label={selected.home_team?.name_ru ?? "Хозяева"} value={home} set={setHome} />
              <span className="score-colon" style={{ alignSelf: "center" }}>:</span>
              <NumberField label={selected.away_team?.name_ru ?? "Гости"} value={away} set={setAway} />
            </div>

            <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="FT">Основное время (FT)</option>
              {isPlayoff && <option value="AET">Доп. время (AET)</option>}
              {isPlayoff && <option value="PEN">Пенальти (PEN)</option>}
              <option value="CANCELLED">Отменён</option>
            </select>

            {status === "PEN" && (
              <div className="row gap-12" style={{ justifyContent: "center" }}>
                <NumberField label="Пен. хоз." value={penH} set={setPenH} />
                <span className="score-colon" style={{ alignSelf: "center" }}>:</span>
                <NumberField label="Пен. гости" value={penA} set={setPenA} />
              </div>
            )}

            <button className="btn btn-primary btn-block" disabled={busy} onClick={submit}>
              {busy ? "…" : "Сохранить и пересчитать"}
            </button>
            <div className="faint center" style={{ fontSize: 11 }}>
              Тото-счёт для плей-офф считается автоматически (победитель пенальти +1 гол).
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function BonusSettleTab() {
  const toast = useToast();
  const { data } = useSWR<MatchesResp>("/matches");
  const [catId, setCatId] = useState(BONUS_META[0].id);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [player, setPlayer] = useState("");
  const [busy, setBusy] = useState(false);

  const meta = BONUS_META.find((c) => c.id === catId)!;
  const teams = useMemo(() => {
    const map = new Map<string, { id: string; name_ru: string; code: string; group: string }>();
    for (const m of data?.matches ?? []) {
      if (m.stage !== "GROUP") continue;
      for (const t of [m.home_team, m.away_team]) if (t?.id && !map.has(t.id)) map.set(t.id, { id: t.id, name_ru: t.name_ru ?? "?", code: t.code ?? "?", group: m.group_code ?? "?" });
    }
    return [...map.values()].sort((a, b) => a.group.localeCompare(b.group) || a.name_ru.localeCompare(b.name_ru));
  }, [data]);

  const complete = meta.itemType === "PLAYER" ? player.trim().length > 0 : picked.size === meta.itemCount;

  async function settle() {
    setBusy(true);
    try {
      const actual = meta.itemType === "PLAYER" ? player.trim() : [...picked];
      await api.patch(`/admin/bonus/${catId}/settle`, { actual });
      toast(`«${meta.nameRu}» подсчитано`, "ok");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Ошибка", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card card-pad stack gap-12">
      <div className="eyebrow">Подведение итогов категории</div>
      <select className="input" value={catId} onChange={(e) => { setCatId(e.target.value); setPicked(new Set()); }}>
        {BONUS_META.map((c) => <option key={c.id} value={c.id}>{c.nameRu} ({c.itemCount})</option>)}
      </select>

      {meta.itemType === "PLAYER" ? (
        <input className="input" placeholder="Имя бомбардира (рус.), напр. Килиан Мбаппе" value={player} onChange={(e) => setPlayer(e.target.value)} />
      ) : (
        <>
          <div className="faint" style={{ fontSize: 12 }}>Выбрано {picked.size}/{meta.itemCount}</div>
          <div className="row wrap gap-6">
            {teams.map((t) => {
              const on = picked.has(t.id);
              return (
                <button key={t.id} className="chip" style={{ cursor: "pointer", borderColor: on ? "var(--gold)" : undefined, color: on ? "var(--gold)" : undefined, background: on ? "rgba(255,195,77,0.12)" : undefined }}
                  onClick={() => setPicked((p) => { const n = new Set(p); if (n.has(t.id)) n.delete(t.id); else if (n.size < meta.itemCount) n.add(t.id); return n; })}>
                  {t.name_ru}
                </button>
              );
            })}
          </div>
        </>
      )}
      <button className="btn btn-gold btn-block" disabled={!complete || busy} onClick={settle}>
        {busy ? "…" : "Подсчитать и пересчитать"}
      </button>
    </div>
  );
}

function ServiceTab() {
  const toast = useToast();
  const [busy, setBusy] = useState("");
  const { data: provider } = useSWR<{ configured: boolean; last_sync: unknown }>("/admin/provider/status");

  async function run(label: string, fn: () => Promise<unknown>, okMsg: string) {
    setBusy(label);
    try {
      await fn();
      toast(okMsg, "ok");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Ошибка", "err");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="stack gap-12">
      <div className="card card-pad stack gap-10">
        <div className="eyebrow">Действия</div>
        <button className="btn btn-block" disabled={!!busy} onClick={() => run("rc", () => api.post("/admin/recalculate", { reason: "manual" }), "Пересчёт выполнен")}>
          {busy === "rc" ? "…" : "Пересчитать очки"}
        </button>
        <button className="btn btn-block" disabled={!!busy} onClick={() => run("ex", () => api.post("/admin/export/sheets", {}), "Экспорт в Google Sheets выполнен")}>
          {busy === "ex" ? "…" : "Экспорт в Google Sheets"}
        </button>
      </div>
      <div className="card card-pad">
        <div className="eyebrow">Провайдер результатов</div>
        <div className="muted mt-8" style={{ fontSize: 13 }}>
          football-data.org: {provider?.configured ? "подключён" : "не настроен (Фаза 2)"}.
          {!provider?.last_sync && " Синхронизаций ещё не было."}
        </div>
      </div>
    </div>
  );
}

function NumberField({ label, value, set }: { label: string; value: number; set: (n: number) => void }) {
  return (
    <div className="score-cell" style={{ maxWidth: 120 }}>
      <span className="faint" style={{ fontSize: 11, textAlign: "center", maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      <input className="input mono" style={{ textAlign: "center", fontSize: 22, padding: "8px" }} inputMode="numeric" value={value}
        onChange={(e) => set(Math.max(0, Math.min(30, Number(e.target.value.replace(/\D/g, "")) || 0)))} />
    </div>
  );
}
