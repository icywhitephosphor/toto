// Display formatting. All times shown in MSK (UTC+3, no DST) per 11 §1.

const dt = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const dateOnly = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  day: "2-digit",
  month: "long",
});
const timeOnly = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  hour: "2-digit",
  minute: "2-digit",
});
const dayKey = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  weekday: "short",
  day: "2-digit",
  month: "long",
});

export const fmtMsk = (iso: string | null) => (iso ? dt.format(new Date(iso)).replace(",", "") : "—");
export const fmtDateMsk = (iso: string | null) => (iso ? dateOnly.format(new Date(iso)) : "—");
export const fmtTimeMsk = (iso: string | null) => (iso ? timeOnly.format(new Date(iso)) : "—");
export const fmtDayKey = (iso: string | null) => (iso ? dayKey.format(new Date(iso)) : "—");

export interface CountdownState {
  locked: boolean;
  label: string;
  urgent: boolean; // < 60 min remaining
}

export function countdown(targetIso: string | null, nowMs: number): CountdownState {
  if (!targetIso) return { locked: false, label: "—", urgent: false };
  const diff = new Date(targetIso).getTime() - nowMs;
  if (diff <= 0) return { locked: true, label: "Закрыто", urgent: false };
  const s = Math.floor(diff / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  const label = d > 0 ? `${d}д ${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(h)}:${pad(m)}:${pad(sec)}`;
  return { locked: false, label, urgent: diff < 3600_000 };
}

export const fmtRub = (n: number) => `${n.toLocaleString("ru-RU")} ₽`;
