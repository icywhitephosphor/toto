"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useBootstrap } from "@/lib/client/bootstrap";
import { api } from "@/lib/client/api";
import { IconHome, IconMatches, IconBonus, IconTable, IconAdmin, IconLogout } from "./icons";
import { ThemeToggle } from "./ThemeToggle";
import { TelegramBack } from "./TelegramBack";

function Wordmark() {
  return (
    <Link href="/" className="wordmark" aria-label="TOTO WC-2026">
      <span className="toto">ТОТО</span>
      <span className="wc">ЧМ-26</span>
      <span className="badge">USA·CAN·MEX</span>
    </Link>
  );
}

const TABS = [
  { href: "/", label: "Главная", Icon: IconHome },
  { href: "/matches", label: "Матчи", Icon: IconMatches },
  { href: "/bonus", label: "Бонусы", Icon: IconBonus },
  { href: "/leaderboard", label: "Таблица", Icon: IconTable },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { data, mutate } = useBootstrap();
  const participant = data?.participant ?? null;
  const isAdmin = data?.user?.is_admin ?? false;
  const showTabs = !!participant;

  async function logout() {
    try {
      await api.post("/auth/logout");
    } catch {
      /* ignore */
    }
    await mutate();
    window.location.href = "/";
  }

  const tabs = isAdmin ? [...TABS, { href: "/admin", label: "Админ", Icon: IconAdmin }] : TABS;

  return (
    <>
      <TelegramBack />
      <div className="app">
        <header className="topbar">
          <Wordmark />
          <div className="topbar-actions">
            <ThemeToggle />
            {data?.user && (
              <button className="btn btn-ghost btn-sm" onClick={logout} title="Выйти">
                <span className="mono" style={{ fontSize: 12, maxWidth: 88, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {participant?.display_name?.split(" ")[0] ?? data.user.first_name ?? "Гость"}
                </span>
                <IconLogout width={16} height={16} />
              </button>
            )}
          </div>
        </header>
        <main>{children}</main>
      </div>

      {showTabs && (
        <nav className="tabbar">
          <div className="tabbar-inner">
            {tabs.map(({ href, label, Icon }) => {
              const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
              return (
                <Link key={href} href={href} className={`tab ${href === "/admin" ? "admin" : ""} ${active ? "active" : ""}`}>
                  <Icon />
                  <span>{label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      )}
    </>
  );
}
