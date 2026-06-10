"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { useBootstrap } from "@/lib/client/bootstrap";
import { useToast } from "./Toast";
import { IconTelegram } from "./icons";

// The bot is fixed; default here so the client shows the right @username even
// when NEXT_PUBLIC_BOT_USERNAME isn't available at build time (Docker build).
const BOT_USERNAME = process.env.NEXT_PUBLIC_BOT_USERNAME ?? "iwp_toto_bot";
const DEV = process.env.NEXT_PUBLIC_ALLOW_DEV_LOGIN === "true";

declare global {
  interface Window {
    Telegram?: { WebApp?: { initData?: string; ready?: () => void; expand?: () => void } };
  }
}

type Mode = "detecting" | "telegram" | "browser";

export function LoginScreen() {
  const { mutate } = useBootstrap();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>("detecting");
  const [tgError, setTgError] = useState(false);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  const doMiniAppLogin = useCallback(async () => {
    const initData = window.Telegram?.WebApp?.initData;
    if (!initData) return;
    setTgError(false);
    try {
      await api.post("/auth/telegram/miniapp", { init_data: initData });
      await mutate();
    } catch {
      setTgError(true);
    }
  }, [mutate]);

  // Detect environment: inside Telegram → auto-login; browser → show entry.
  // initData can arrive a tick after mount (SDK still wiring up), so poll
  // briefly before concluding "browser" — otherwise a real Mini App user can
  // get stuck on the "Открыть в Telegram" screen.
  useEffect(() => {
    if (started.current) return;
    let cancelled = false;
    let attempts = 0;
    const MAX = 20; // ~3s of 150ms ticks before giving up on a Mini App context

    const detect = () => {
      if (cancelled || started.current) return;
      const wa = window.Telegram?.WebApp;
      wa?.ready?.(); // nudge the SDK to surface initData if it has it
      const initData = wa?.initData;
      if (initData && initData.length > 0) {
        started.current = true;
        wa?.expand?.();
        setMode("telegram");
        void doMiniAppLogin();
        return;
      }
      if (attempts++ < MAX) {
        setTimeout(detect, 150);
        return;
      }
      started.current = true;
      setMode("browser");
    };

    detect();
    return () => {
      cancelled = true;
    };
  }, [doMiniAppLogin]);

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
      <section className="card" style={{ overflow: "hidden", position: "relative" }}>
        <div style={{ padding: "30px 22px 26px", position: "relative" }}>
          <div className="eyebrow">11 июня — 19 июля · USA · Canada · Mexico</div>
          <h1 className="h-display" style={{ fontSize: 58, marginTop: 10 }}>
            ТОТО<br />
            <span style={{ color: "var(--pitch)" }}>ЧМ-2026</span>
          </h1>
          <p className="muted" style={{ fontSize: 15, marginTop: 12, maxWidth: 360 }}>
            Дружеский тотализатор на Чемпионат мира по футболу.
          </p>

          <div className="stack gap-10 mt-24">
            {mode === "telegram" &&
              (tgError ? (
                <>
                  <div className="banner warn">Не удалось войти автоматически.</div>
                  <button className="btn btn-primary btn-block" onClick={doMiniAppLogin}>
                    Повторить вход
                  </button>
                </>
              ) : (
                <div className="muted center" style={{ fontSize: 15, padding: "6px 0" }}>
                  Входим…
                </div>
              ))}

            {mode === "browser" && (
              <>
                <a className="btn btn-primary btn-block" href={`https://t.me/${BOT_USERNAME}`} target="_blank" rel="noreferrer">
                  <IconTelegram width={18} height={18} /> Открыть в Telegram
                </a>
                <div className="faint center" style={{ fontSize: 12 }}>
                  Приложение работает в Telegram — бот <span className="mono">@{BOT_USERNAME}</span>
                </div>
              </>
            )}
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
            boxShadow: "0 0 0 22px var(--pitch-faint)",
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
            <button className="btn btn-gold btn-block btn-sm" type="button" disabled={busy} onClick={() => devLogin(100001, "Админ")}>
              Войти администратором (dev)
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
