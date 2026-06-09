"use client";
import Link from "next/link";
import useSWR from "swr";
import { useBootstrap } from "@/lib/client/bootstrap";
import { PageHead, Empty, CardSkeleton } from "@/components/ui";
import { ApiError } from "@/lib/client/api";

interface RevealResp {
  bonus_deadline_at: string;
  categories: Array<{
    category_id: string;
    name_ru: string;
    item_count: number;
    points_per_correct: number;
    settled: boolean;
    actual_items: Array<{ name_ru?: string | null; player_name?: string | null }> | null;
    participants: Array<{ participant_id: string; display_name: string; items: Array<{ name_ru?: string | null; player_name?: string | null }>; points_earned: number | null }>;
  }>;
}

export default function BonusRevealPage() {
  const { data: boot } = useBootstrap();
  const { data, isLoading, error } = useSWR<RevealResp>(boot?.participant ? "/bonus/reveal" : null);

  if (!boot?.participant) {
    return (
      <div style={{ paddingTop: 40 }}>
        <Empty title="Нужно войти" />
        <Link href="/" className="btn btn-primary btn-block mt-16">На главную</Link>
      </div>
    );
  }

  const locked = error instanceof ApiError && error.code === "REVEAL_BEFORE_DEADLINE";

  return (
    <div>
      <PageHead eyebrow="После дедлайна" title="Бонусы всех" right={<Link href="/bonus" className="chip">← мои</Link>} />
      {locked && <div className="banner warn">Бонусы скрыты до 10 июня, 23:00 МСК.</div>}
      {isLoading && <CardSkeleton count={4} />}

      <div className="stack gap-16">
        {data?.categories.map((c) => (
          <section key={c.category_id} className="card card-pad">
            <div className="row between">
              <div className="section-title" style={{ fontSize: 16 }}>{c.name_ru}</div>
              <span className={`chip ${c.settled ? "chip-open" : "chip-locked"}`}>
                {c.settled ? "подсчитано" : "ожидает"} · {c.points_per_correct} очк.
              </span>
            </div>
            {c.settled && c.actual_items && (
              <div className="row wrap gap-6 mt-12">
                <span className="faint" style={{ fontSize: 12 }}>Верно:</span>
                {c.actual_items.map((it, i) => (
                  <span key={i} className="chip chip-gold">{it.name_ru ?? it.player_name}</span>
                ))}
              </div>
            )}
            <div className="stack mt-12">
              {c.participants.map((p) => (
                <div key={p.participant_id} className="lb-row" style={{ gridTemplateColumns: "120px 1fr auto", gap: 10, padding: "10px 0" }}>
                  <span className="lb-name" style={{ fontSize: 13 }}>{p.display_name}</span>
                  <span className="faint" style={{ fontSize: 12, lineHeight: 1.5 }}>
                    {p.items.length ? p.items.map((it) => it.name_ru ?? it.player_name).join(", ") : "—"}
                  </span>
                  <span className="lb-pts" style={{ fontSize: 16 }}>{p.points_earned ?? "·"}</span>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
