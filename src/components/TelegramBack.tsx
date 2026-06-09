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
    const wa = (window as unknown as { Telegram?: { WebApp?: { BackButton?: BackButton } } }).Telegram?.WebApp;
    const bb = wa?.BackButton;
    if (!bb) return;
    const handler = () => router.back();
    if (ROOTS.has(pathname)) bb.hide?.();
    else bb.show?.();
    bb.onClick?.(handler);
    return () => {
      bb.offClick?.(handler);
    };
  }, [pathname, router]);

  return null;
}
