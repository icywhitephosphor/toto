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

// Telegram launches a Mini App with the raw init data ALSO in the URL hash
// (#tgWebAppData=<percent-encoded>). Reading it directly makes login work even
// when the telegram.org SDK script is slow or blocked (common on RU mobile
// networks) — exactly the case that produced the "bounces between two windows"
// loop: no SDK → we wrongly concluded "browser" → «Открыть в Telegram» → chat
// → app → repeat.
function initDataFromHash(): string | null {
  const m = /tgWebAppData=([^&]+)/.exec(window.location.hash);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

/** Are we inside a Telegram webview at all (even if the SDK never loads)? */
function inTelegramContext(): boolean {
  return /tgWebAppPlatform=/.test(window.location.hash) || window.location.hash.includes("tgWebAppData=");
}

export function LoginScreen() {
  const { mutate } = useBootstrap();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>("detecting");
  const [tgError, setTgError] = useState(false);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);
  // /api/auth/browser-login redirects here with ?link=expired on a dead link.
  const [linkExpired] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("link") === "expired",
  );

  const doMiniAppLogin = useCallback(async () => {
    const initData = window.Telegram?.WebApp?.initData || initDataFromHash();
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
  // Priority: URL-hash init data (instant, SDK-independent) → SDK initData
  // (may arrive a tick after mount) → browser. Poll longer when the hash says
  // we ARE in Telegram, since the only thing missing is the slow SDK.
  useEffect(() => {
    if (started.current) return;
    let cancelled = false;
    let attempts = 0;

    const detect = () => {
      if (cancelled || started.current) return;
      const wa = window.Telegram?.WebApp;
      wa?.ready?.(); // nudge the SDK to surface initData if it has it
      const initData = wa?.initData || initDataFromHash();
      if (initData && initData.length > 0) {
        started.current = true;
        wa?.expand?.();
        setMode("telegram");
        void doMiniAppLogin();
        return;
      }
      // ~3s normally; ~10s when the hash proves a Telegram context.
      const MAX = inTelegramContext() ? 65 : 20;
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

  // Telegram Login Widget (CSP already allows telegram.org/oauth.telegram.org;
  // requires BotFather /setdomain). Shown in plain browsers AND as a fallback
  // when Mini App auto-login fails (e.g. stale cached initData on Android).
  const widgetRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (mode !== "browser" && !tgError) return;
    const host = widgetRef.current;
    if (!host || host.childElementCount > 0) return;
    (window as unknown as { onTelegramAuth?: (u: unknown) => void }).onTelegramAuth = async (user) => {
      try {
        await api.post("/auth/telegram/widget", user as Record<string, unknown>);
        await mutate();
      } catch (e) {
        toast(e instanceof ApiError ? e.message : "Не удалось войти", "err");
      }
    };
    const s = document.createElement("script");
    s.src = "https://telegram.org/js/telegram-widget.js?22";
    s.async = true;
    s.setAttribute("data-telegram-login", BOT_USERNAME);
    s.setAttribute("data-size", "large");
    s.setAttribute("data-radius", "14");
    s.setAttribute("data-onauth", "onTelegramAuth(user)");
    host.appendChild(s);
  }, [mode, tgError, mutate, toast]);

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
            {linkExpired && (
              <div className="banner warn">
                Ссылка для входа истекла или уже использована — получите новую в приложении
                (Главная → «Веб-версия»).
              </div>
            )}
            {mode === "telegram" &&
              (tgError ? (
                <>
                  <div className="banner warn">Не удалось войти автоматически.</div>
                  <button className="btn btn-primary btn-block" onClick={doMiniAppLogin}>
                    Повторить вход
                  </button>
                  <div ref={widgetRef} className="center" style={{ display: "flex", justifyContent: "center" }} />
                  <div className="faint center" style={{ fontSize: 12 }}>
                    …или войдите кнопкой Telegram выше
                  </div>
                </>
              ) : (
                <div className="muted center" style={{ fontSize: 15, padding: "6px 0" }}>
                  Входим…
                </div>
              ))}

            {mode === "browser" && (
              <>
                <div ref={widgetRef} className="center" style={{ display: "flex", justifyContent: "center" }} />
                <a className="btn btn-block" href={`https://t.me/${BOT_USERNAME}`} target="_blank" rel="noreferrer">
                  <IconTelegram width={18} height={18} /> Открыть в Telegram
                </a>
                <div className="faint center" style={{ fontSize: 12 }}>
                  Вход через Telegram — в браузере кнопкой выше или в мини-приложении бота <span className="mono">@{BOT_USERNAME}</span>
                </div>
                <div className="banner" style={{ fontSize: 12.5 }}>
                  Уже играете в Telegram? Откройте приложение → Главная → «Веб-версия» —
                  получите одноразовую ссылку и войдите здесь без Telegram.
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
