"use client";
import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import { api, ApiError } from "@/lib/client/api";
import { useBootstrap } from "@/lib/client/bootstrap";
import { useToast } from "./Toast";
import { IconTelegram } from "./icons";

const BOT_USERNAME = process.env.NEXT_PUBLIC_BOT_USERNAME ?? "toto_wc2026_bot";
const DEV = process.env.NEXT_PUBLIC_ALLOW_DEV_LOGIN === "true";

declare global {
  interface Window {
    Telegram?: { WebApp?: { initData?: string; ready?: () => void; expand?: () => void } };
    onTelegramAuth?: (user: Record<string, unknown>) => void;
  }
}

export function LoginScreen() {
  const { mutate } = useBootstrap();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const triedMiniApp = useRef(false);

  // Telegram Mini App: auto-login if launched inside the Telegram webview.
  useEffect(() => {
    if (triedMiniApp.current) return;
    triedMiniApp.current = true;
    const initData = window.Telegram?.WebApp?.initData;
    if (initData && initData.length > 0) {
      window.Telegram?.WebApp?.ready?.();
      window.Telegram?.WebApp?.expand?.();
      (async () => {
        try {
          await api.post("/auth/telegram/miniapp", { init_data: initData });
          await mutate();
        } catch {
          /* fall through to manual options */
        }
      })();
    }
  }, [mutate]);

  // Login Widget callback (browser fallback).
  useEffect(() => {
    window.onTelegramAuth = async (user) => {
      try {
        await api.post("/auth/telegram/widget", user);
        await mutate();
      } catch (e) {
        toast(e instanceof ApiError ? e.message : "Ошибка входа", "err");
      }
    };
    return () => {
      delete window.onTelegramAuth;
    };
  }, [mutate, toast]);

  async function devLogin(tg: number, name: string) {
    setBusy(true);
    try {
      await api.post("/auth/dev", { telegram_id: tg, first_name: name, username: `dev${tg}` });
      await mutate();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Ошибка", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rise" style={{ paddingTop: 18 }}>
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" />

      <section className="card" style={{ overflow: "hidden", position: "relative" }}>
        <div style={{ padding: "30px 22px 26px", position: "relative" }}>
          <div className="eyebrow">11 июня — 19 июля · USA · Canada · Mexico</div>
          <h1 className="h-display" style={{ fontSize: 58, marginTop: 10 }}>
            ТОТО<br />
            <span style={{ color: "var(--pitch)" }}>ЧМ-2026</span>
          </h1>
          <p className="muted" style={{ fontSize: 15, marginTop: 12, maxWidth: 360 }}>
            Дружеский тотализатор на Чемпионат мира по футболу. Свои прогнозы, честные дедлайны,
            живая таблица и бонусы. Только для своих — 21 участник.
          </p>

          <div className="stack gap-10 mt-24">
            <a
              className="btn btn-primary btn-block"
              href={`https://t.me/${BOT_USERNAME}`}
              target="_blank"
              rel="noreferrer"
            >
              <IconTelegram width={18} height={18} /> Открыть в Telegram
            </a>
            <div className="faint center" style={{ fontSize: 12 }}>
              Войдите через бота <span className="mono">@{BOT_USERNAME}</span>
            </div>
          </div>
        </div>

        <div
          aria-hidden
          style={{
            position: "absolute",
            right: -40,
            bottom: -40,
            width: 220,
            height: 220,
            borderRadius: "50%",
            border: "1px solid var(--line)",
            boxShadow: "0 0 0 22px rgba(196,247,63,0.03)",
          }}
        />
      </section>

      {DEV && (
        <section className="card card-pad mt-16">
          <div className="eyebrow">Локальная разработка</div>
          <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
            Вход без Telegram (только для разработки и тестов).
          </p>
          <form
            className="stack gap-10 mt-12"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              devLogin(Number(fd.get("tg")), String(fd.get("name") || "Тестер"));
            }}
          >
            <input className="input" name="name" placeholder="Имя" defaultValue="Тест Тестов" />
            <input className="input" name="tg" placeholder="Telegram ID" defaultValue="200500" inputMode="numeric" />
            <button className="btn btn-block" type="submit" disabled={busy}>
              {busy ? "…" : "Войти (dev)"}
            </button>
            <button
              className="btn btn-gold btn-block btn-sm"
              type="button"
              disabled={busy}
              onClick={() => devLogin(100001, "Админ")}
            >
              Войти администратором (dev)
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
