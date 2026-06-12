"use client";
// Opt-in web fallback: mint a one-time magic link that logs THIS user into any
// browser (Telegram stays the primary login). The link is single-use and lives
// 10 minutes, so sharing UX leans on copy/share — never on retyping.
import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { useToast } from "./Toast";

interface LinkResp {
  url: string;
  expires_in_seconds: number;
}

export function BrowserLink() {
  const toast = useToast();
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function mint() {
    setBusy(true);
    try {
      const r = await api.post<LinkResp>("/auth/browser-link");
      setUrl(r.url);
      try {
        await navigator.clipboard.writeText(r.url);
        toast("Ссылка скопирована", "ok");
      } catch {
        /* clipboard may be unavailable inside the webview — the box below shows it */
      }
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Не удалось создать ссылку", "err");
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    if (!url) return;
    try {
      if (navigator.share) await navigator.share({ title: "ТОТО ЧМ-2026", url });
      else {
        await navigator.clipboard.writeText(url);
        toast("Ссылка скопирована", "ok");
      }
    } catch {
      /* user dismissed the share sheet */
    }
  }

  return (
    <div className="card card-pad mt-16">
      <div className="row between gap-12">
        <div>
          <div className="section-title" style={{ fontSize: 15 }}>💻 Веб-версия</div>
          <div className="faint" style={{ fontSize: 12, marginTop: 3 }}>
            Одноразовая ссылка для входа в браузере — на компьютере или где угодно.
          </div>
        </div>
        <button className="btn btn-sm" disabled={busy} onClick={mint}>
          {busy ? "…" : url ? "Новая ссылка" : "Получить ссылку"}
        </button>
      </div>

      {url && (
        <div className="rise mt-12">
          <div
            className="mono"
            style={{
              fontSize: 11,
              padding: "10px 12px",
              background: "var(--input-bg)",
              border: "1px solid var(--line)",
              borderRadius: "var(--r)",
              wordBreak: "break-all",
              userSelect: "all",
            }}
          >
            {url}
          </div>
          <div className="row gap-8 mt-8">
            <button className="btn btn-sm" onClick={share}>Поделиться</button>
            <span className="faint" style={{ fontSize: 11 }}>
              Действует 10 минут, вход одноразовый. Никому не пересылайте — это вход в ваш аккаунт.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
