"use client";
import { useEffect } from "react";

// Keep the browser chrome (mobile address bar) and the Telegram Mini App header
// in step with the active theme. The inline script in layout.tsx sets the
// <meta name="theme-color"> before first paint; this re-applies it (and the
// Telegram colours, which need the SDK loaded) on mount and on every toggle.
const FALLBACK: Record<string, string> = { light: "#f3f5f1", dark: "#0d0f13" };

function apply() {
  if (typeof document === "undefined") return;
  const theme = document.documentElement.getAttribute("data-theme") ?? "dark";
  const bg =
    getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() ||
    FALLBACK[theme] ||
    FALLBACK.dark;

  let meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  meta.content = bg;

  // Telegram Mini App chrome. Hex colours need Bot API 6.9+; on older clients
  // the SDK warns/throws, so gate on the version and still guard each call.
  const tg = (
    window as unknown as {
      Telegram?: {
        WebApp?: {
          isVersionAtLeast?: (v: string) => boolean;
          setHeaderColor?: (c: string) => void;
          setBackgroundColor?: (c: string) => void;
        };
      };
    }
  ).Telegram?.WebApp;
  if (tg?.isVersionAtLeast?.("6.9")) {
    try { tg.setHeaderColor?.(bg); } catch { /* unsupported client */ }
    try { tg.setBackgroundColor?.(bg); } catch { /* unsupported client */ }
  }
}

export function ThemeColorSync() {
  useEffect(() => {
    apply();
    const obs = new MutationObserver(apply);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return null;
}
