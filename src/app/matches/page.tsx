"use client";
import { useState } from "react";
import Link from "next/link";
import { useBootstrap } from "@/lib/client/bootstrap";
import { MatchCalendar } from "@/components/MatchCalendar";
import { PlayoffBracket } from "@/components/PlayoffBracket";
import { PageHead, Empty } from "@/components/ui";

export default function MatchesPage() {
  const { data: boot } = useBootstrap();
  const [view, setView] = useState<"cal" | "bracket">("cal");

  if (!boot?.participant) return <NeedLogin />;

  return (
    <div>
      <PageHead eyebrow="ЧМ-2026 · время МСК" title="Матчи" />

      <div className="segmented" style={{ marginBottom: 16 }}>
        <button className={`seg ${view === "cal" ? "active" : ""}`} onClick={() => setView("cal")}>Календарь</button>
        <button className={`seg ${view === "bracket" ? "active" : ""}`} onClick={() => setView("bracket")}>Сетка плей-офф</button>
      </div>

      {view === "cal" ? <MatchCalendar /> : <PlayoffBracket />}
    </div>
  );
}

function NeedLogin() {
  return (
    <div style={{ paddingTop: 40 }}>
      <Empty title="Нужно войти" sub="Авторизуйтесь и выберите своё имя, чтобы делать ставки." />
      <Link href="/" className="btn btn-primary btn-block mt-16">На главную</Link>
    </div>
  );
}
