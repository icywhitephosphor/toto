"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { useBootstrap } from "@/lib/client/bootstrap";
import { PageHead, Empty, CardSkeleton, BackLink } from "@/components/ui";
import { ApiError } from "@/lib/client/api";
import { flag } from "@/lib/client/flags";

interface RevealItem {
  team_id?: string;
  code?: string | null;
  name_ru?: string | null;
  player_name?: string | null;
}
interface RevealResp {
  bonus_deadline_at: string;
  categories: Array<{
    category_id: string;
    name_ru: string;
    item_count: number;
    points_per_correct: number;
    settled: boolean;
    actual_items: RevealItem[] | null;
    participants: Array<{ participant_id: string; display_name: string; items: RevealItem[]; points_earned: number | null }>;
  }>;
}

const itemLabel = (it: RevealItem) => it.name_ru ?? it.player_name ?? "?";
const itemText = (it: RevealItem) => (it.code ? `${flag(it.code)} ${itemLabel(it)}` : itemLabel(it));

/** Did this pick match the settled outcome? Teams by id, players by name. */
function isHit(it: RevealItem, actual: RevealItem[] | null): boolean {
  if (!actual) return false;
  if (it.team_id) return actual.some((a) => a.team_id === it.team_id);
  const name = it.player_name?.trim().toLowerCase();
  return !!name && actual.some((a) => a.player_name?.trim().toLowerCase() === name);
}

export default function BonusRevealPage() {
  const { data: boot } = useBootstrap();
  const { data, isLoading, error } = useSWR<RevealResp>(boot?.participant ? "/bonus/reveal" : null);
  const [mode, setMode] = useState<"person" | "category">("person");
  const [picked, setPicked] = useState<string | null>(null);

  const people = useMemo(() => {
    const list = data?.categories[0]?.participants.map((p) => ({ id: p.participant_id, name: p.display_name })) ?? [];
    return [...list].sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [data]);

  const selectedId = picked ?? boot?.participant?.id ?? people[0]?.id ?? null;

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
      <BackLink href="/bonus" label="К моим бонусам" />
      <PageHead title="Бонусы всех" />
      {locked && <div className="banner warn">Бонусы скрыты до 10 июня, 23:00 МСК.</div>}
      {isLoading && <CardSkeleton count={4} />}

      {data && (
        <>
          <div className="segmented" style={{ marginBottom: 12 }}>
            <button className={`seg ${mode === "person" ? "active" : ""}`} onClick={() => setMode("person")}>По участнику</button>
            <button className={`seg ${mode === "category" ? "active" : ""}`} onClick={() => setMode("category")}>По категориям</button>
          </div>

          {mode === "person" ? (
            <PersonView data={data} people={people} selectedId={selectedId} meId={boot.participant.id} onPick={setPicked} />
          ) : (
            <CategoryView data={data} />
          )}
        </>
      )}
    </div>
  );
}

function PersonView({
  data,
  people,
  selectedId,
  meId,
  onPick,
}: {
  data: RevealResp;
  people: Array<{ id: string; name: string }>;
  selectedId: string | null;
  meId: string;
  onPick: (id: string) => void;
}) {
  const total = data.categories.reduce((sum, c) => {
    const p = c.participants.find((x) => x.participant_id === selectedId);
    return sum + (p?.points_earned ?? 0);
  }, 0);
  const anySettled = data.categories.some((c) => c.settled);

  return (
    <div className="stack gap-12">
      <select className="input" value={selectedId ?? ""} onChange={(e) => onPick(e.target.value)} aria-label="Чьи ставки показать">
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}{p.id === meId ? " · вы" : ""}
          </option>
        ))}
      </select>

      {anySettled && (
        <div className="banner gold">Очки за бонусы: <b>{total}</b></div>
      )}

      {data.categories.map((c) => {
        const person = c.participants.find((p) => p.participant_id === selectedId);
        return (
          <section key={c.category_id} className="card card-pad">
            <div className="row between">
              <div className="section-title" style={{ fontSize: 16 }}>{c.name_ru}</div>
              {c.settled
                ? <span className="chip chip-open">{person?.points_earned ?? 0} очк.</span>
                : <span className="chip">{c.points_per_correct} очк./шт</span>}
            </div>
            <div className="row wrap gap-6 mt-12">
              {person?.items.length
                ? person.items.map((it, i) => (
                    <span key={i} className={`chip ${c.settled && isHit(it, c.actual_items) ? "chip-gold" : ""}`}>
                      {it.code && <span className="tflag" style={{ fontSize: 14 }}>{flag(it.code)}</span>}
                      {itemLabel(it)}
                    </span>
                  ))
                : <span className="faint" style={{ fontSize: 13 }}>не заполнено</span>}
            </div>
            {c.settled && c.actual_items && (
              <div className="row wrap gap-6 mt-12" style={{ alignItems: "center" }}>
                <span className="faint" style={{ fontSize: 12 }}>Верно:</span>
                {c.actual_items.map((it, i) => (
                  <span key={i} className="chip chip-gold">{itemText(it)}</span>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function CategoryView({ data }: { data: RevealResp }) {
  const [catId, setCatId] = useState(data.categories[0]?.category_id ?? "");
  const shown = data.categories.filter((c) => c.category_id === catId);
  return (
    <div className="stack gap-12">
      <select className="input" value={catId} onChange={(e) => setCatId(e.target.value)} aria-label="Категория">
        {data.categories.map((c) => (
          <option key={c.category_id} value={c.category_id}>{c.name_ru}</option>
        ))}
      </select>
      {shown.map((c) => (
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
                <span key={i} className="chip chip-gold">{itemText(it)}</span>
              ))}
            </div>
          )}
          <div className="stack mt-12">
            {c.participants.map((p) => (
              <div key={p.participant_id} className="lb-row" style={{ gridTemplateColumns: "108px 1fr auto", gap: 10, padding: "10px 0", alignItems: "start" }}>
                <span className="lb-name" style={{ fontSize: 13 }}>{p.display_name}</span>
                <span className="faint" style={{ fontSize: 12, lineHeight: 1.5 }}>
                  {p.items.length ? p.items.map(itemText).join(", ") : "—"}
                </span>
                <span className="lb-pts" style={{ fontSize: 16 }}>{p.points_earned ?? "·"}</span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
