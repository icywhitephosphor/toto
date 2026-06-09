"use client";
import { useState } from "react";
import useSWR from "swr";
import { api, ApiError, fetcher } from "@/lib/client/api";
import { useBootstrap } from "@/lib/client/bootstrap";
import { useToast } from "./Toast";
import { IconCheck, IconLock } from "./icons";

interface RosterResp {
  participants: Array<{ id: string; roster_no: number; display_name: string; claimed: boolean; is_self: boolean }>;
}

export function ClaimScreen() {
  const { mutate } = useBootstrap();
  const toast = useToast();
  const { data, isLoading, mutate: refetch } = useSWR<RosterResp>("/participants", fetcher);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  async function claim(id: string, name: string) {
    setBusyId(id);
    try {
      await api.post("/participants/claim", { participant_id: id });
      toast(`Готово! Вы — ${name}`, "ok");
      await mutate();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Ошибка", "err");
      await refetch();
      setSelected(null);
    } finally {
      setBusyId(null);
    }
  }

  const rows = data?.participants ?? [];
  const claimedCount = rows.filter((r) => r.claimed).length;

  return (
    <div className="rise" style={{ paddingTop: 8 }}>
      <div className="eyebrow">Шаг 2 из 2</div>
      <h1 className="h-display" style={{ fontSize: 34, marginTop: 4 }}>Кто вы?</h1>
      <p className="muted" style={{ fontSize: 14, marginTop: 6 }}>
        Выберите своё имя из ростера. Привязка к Telegram — одна и навсегда (поменять может только
        администратор). Занято: {claimedCount} из {rows.length || 21}.
      </p>

      <div className="card mt-16" style={{ padding: 6 }}>
        {isLoading && <div className="skel" style={{ height: 320, margin: 6 }} />}
        {rows.map((p) => {
          const disabled = p.claimed || busyId !== null;
          return (
            <button
              key={p.id}
              className="lb-row"
              style={{
                width: "100%",
                background: selected === p.id ? "rgba(196,247,63,0.06)" : "transparent",
                border: "none",
                textAlign: "left",
                cursor: p.claimed ? "default" : "pointer",
                opacity: p.claimed ? 0.5 : 1,
              }}
              disabled={disabled}
              onClick={() => {
                setSelected(p.id);
                claim(p.id, p.display_name);
              }}
            >
              <span className="lb-place" style={{ fontSize: 16 }}>{p.roster_no}</span>
              <span className="lb-name">{p.display_name}</span>
              {p.claimed ? (
                <IconLock width={16} height={16} style={{ color: "var(--ink-faint)" }} />
              ) : busyId === p.id ? (
                <span className="mono faint">…</span>
              ) : (
                <span className="chip chip-open"><IconCheck width={12} height={12} /> выбрать</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
