import "./globals.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Oswald, Onest, JetBrains_Mono } from "next/font/google";
import { Providers } from "@/components/Providers";
import { ThemeColorSync } from "@/components/ThemeColorSync";
import { TelegramInit } from "@/components/TelegramInit";

// Cyrillic-complete typeface trio. Oswald = condensed stadium/scoreboard display,
// Onest = modern grotesk body, JetBrains Mono = numerals/countdowns.
const oswald = Oswald({ subsets: ["latin", "cyrillic"], weight: ["400", "500", "600", "700"], variable: "--font-oswald", display: "swap" });
const onest = Onest({ subsets: ["latin", "cyrillic"], variable: "--font-onest", display: "swap" });
const jbmono = JetBrains_Mono({ subsets: ["latin", "cyrillic"], variable: "--font-jbmono", display: "swap" });

export const metadata: Metadata = {
  title: "TOTO WC-2026 — Тотализатор на ЧМ-2026",
  description: "Прогнозы на Чемпионат мира по футболу 2026. Логин через Telegram, живая таблица, бонусы.",
};

// theme-color is managed dynamically (ThemeColorSync + the inline script below)
// so the browser/Telegram chrome tracks the active theme, not a fixed colour.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

// Set the theme + matching chrome colour before first paint to avoid a flash
// (reads saved choice, else falls back to the OS preference). The toggle later
// writes localStorage; ThemeColorSync keeps the meta in step afterwards.
const themeScript = `(function(){try{var t=localStorage.getItem('toto-theme');if(!t){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}document.documentElement.setAttribute('data-theme',t);var c=t==='light'?'#f3f5f1':'#0d0f13';var m=document.querySelector('meta[name="theme-color"]');if(!m){m=document.createElement('meta');m.setAttribute('name','theme-color');document.head.appendChild(m);}m.setAttribute('content',c);}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="ru"
      data-theme="dark"
      suppressHydrationWarning
      className={`${oswald.variable} ${onest.variable} ${jbmono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {/* Telegram Mini App SDK. `async` is critical: telegram.org is slow or
            outright blocked on RU mobile networks, and a sync script here holds
            the ENTIRE first paint hostage (blank screen on phones). Login reads
            initData from the URL hash as a fallback, and TelegramInit/[Back]/
            ThemeColorSync all poll for the SDK, so late arrival is fine. */}
        <link rel="preconnect" href="https://telegram.org" />
        <script src="https://telegram.org/js/telegram-web-app.js" async />
      </head>
      <body>
        <TelegramInit />
        <ThemeColorSync />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
