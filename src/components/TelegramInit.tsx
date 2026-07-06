"use client";
import { useEffect } from "react";

// Global Mini App handshake. ready() dismisses Telegram's own loading
// placeholder and expand() opens the app full-height — BOTH must run on every
// launch, not just on the login screen (before this, a returning logged-in
// user never called them: spinner lingered and the app opened half-height).
// The SDK script is async (see layout.tsx), so poll briefly until it lands.
export function TelegramInit() {
  useEffect(() => {
    let cancelled = false;
    let attempts = 0;

    const init = () => {
      if (cancelled) return;
      const wa = (window as unknown as {
        Telegram?: { WebApp?: { ready?: () => void; expand?: () => void } };
      }).Telegram?.WebApp;
      if (!wa) {
        // ~15s: covers a slow telegram.org fetch on mobile networks; in a
        // plain browser the SDK never appears and we just stop quietly.
        if (attempts++ < 100) setTimeout(init, 150);
        return;
      }
      try { wa.ready?.(); } catch { /* old client */ }
      try { wa.expand?.(); } catch { /* old client */ }
    };
    init();

    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
