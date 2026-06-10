"use client";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

// Tab roots: no back button. Everything else shows the Telegram native back
// button (Mini App) wired to router.back(). Browser users use in-app "←" links.
const ROOTS = new Set(["/", "/matches", "/bonus", "/leaderboard", "/admin"]);

type BackButton = {
  show?: () => void;
  hide?: () => void;
  onClick?: (cb: () => void) => void;
  offClick?: (cb: () => void) => void;
};

export function TelegramBack() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const handler = () => router.back();
    let bound: BackButton | null = null;

    // The Mini App SDK may not have populated BackButton on first paint; poll
    // briefly instead of silently giving up (no back button for the session).
    const apply = () => {
      if (cancelled) return;
      const wa = (window as unknown as { Telegram?: { WebApp?: { BackButton?: BackButton } } }).Telegram?.WebApp;
      const bb = wa?.BackButton;
      if (!bb) {
        if (attempts++ < 20) setTimeout(apply, 150);
        return;
      }
      bound = bb;
      if (ROOTS.has(pathname)) bb.hide?.();
      else bb.show?.();
      bb.onClick?.(handler);
    };
    apply();

    return () => {
      cancelled = true;
      bound?.offClick?.(handler);
    };
  }, [pathname, router]);

  return null;
}
