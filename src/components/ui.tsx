"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { useServerClock } from "@/lib/client/hooks";
import { countdown } from "@/lib/client/format";
import type { ApiTeam, Stage } from "@/lib/client/types";
import { flag } from "@/lib/client/flags";
import { IconChevron, IconLock } from "./icons";

export const STAGE_LABEL: Record<Stage, string> = {
  GROUP: "Группа",
  R32: "1/16",
  R16: "1/8",
  QF: "1/4",
  SF: "1/2",
  THIRD: "За 3-е",
  FINAL: "Финал",
};

export function StageBadge({ stage, group }: { stage: Stage; group?: string | null }) {
  const label = stage === "GROUP" && group ? `Группа ${group}` : STAGE_LABEL[stage];
  return <span className="chip">{label}</span>;
}

export function TeamPill({ team, slot, align = "left", size }: { team: ApiTeam | null; slot?: string | null; align?: "left" | "right"; size?: "sm" }) {
  const name = team?.name_ru ?? slotLabel(slot) ?? "Уточняется";
  return (
    <span className="team" style={{ flexDirection: align === "right" ? "row-reverse" : "row", justifyContent: align === "right" ? "flex-end" : "flex-start" }}>
      {team && <span className="tflag">{flag(team.code)}</span>}
      <span className={`tname ${size === "sm" ? "sm" : ""}`}>{name}</span>
    </span>
  );
}

/** Human label for an unresolved bracket slot ('W-A', 'RU-B', '3RD:…', 'W73'). */
export function slotLabel(slot?: string | null): string | null {
  if (!slot) return null;
  if (slot.startsWith("W-")) return `1-е группы ${slot.slice(2)}`;
  if (slot.startsWith("RU-")) return `2-е группы ${slot.slice(3)}`;
  if (slot.startsWith("3RD:")) return `3-е из ${slot.slice(4)}`;
  if (/^W\d+$/.test(slot)) return `Победитель м.${slot.slice(1)}`;
  if (/^L\d+$/.test(slot)) return `Проигравший м.${slot.slice(1)}`;
  return slot;
}

export function Countdown({ target }: { target: string | null }) {
  const now = useServerClock(1000);
  const st = countdown(target, now);
  if (st.locked) {
    return (
      <span className="chip chip-locked">
        <IconLock width={12} height={12} /> Закрыто
      </span>
    );
  }
  return (
    <span className={`chip ${st.urgent ? "chip-live" : "chip-open"} countdown`}>
      {st.urgent && <span className="dot" />}
      {st.label}
    </span>
  );
}

export function Empty({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="card card-pad center" style={{ padding: "32px 16px" }}>
      <div className="section-title" style={{ color: "var(--ink-dim)" }}>{title}</div>
      {sub && <div className="muted mt-8" style={{ fontSize: 14 }}>{sub}</div>}
    </div>
  );
}

export function CardSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="stack gap-12">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skel" style={{ height: 132 }} />
      ))}
    </div>
  );
}

export function PageHead({ eyebrow, title, right }: { eyebrow?: string; title: string; right?: ReactNode }) {
  return (
    <div className="row between mt-8" style={{ alignItems: "flex-end", marginBottom: 14 }}>
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 className="h-display" style={{ fontSize: 34, marginTop: 4 }}>{title}</h1>
      </div>
      {right}
    </div>
  );
}

/* Deterministic in-app back navigation for drill-in pages (Mini App users also
   get the native Telegram back button via <TelegramBack/>). */
export function BackLink({ href, label = "Назад" }: { href: string; label?: string }) {
  return (
    <Link href={href} className="backlink">
      <IconChevron width={15} height={15} style={{ transform: "rotate(180deg)" }} />
      {label}
    </Link>
  );
}
