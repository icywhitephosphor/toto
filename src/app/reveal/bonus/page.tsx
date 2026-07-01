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
interface RevealCat {
  category_id: string;
  name_ru: string;
  item_count: number;
  item_type: "TEAM" | "PLAYER";
  points_per_correct: number;
  settled: boolean;
  /** Final answer set fully known → non-hit picks are real misses, not pending. */
  complete: boolean;
  actual_items: RevealItem[] | null;
  participants: Array<{ participant_id: string; display_name: string; items: RevealItem[]; points_earned: number | null }>;
}
interface RevealResp {
  bonus_deadline_at: string;
  /** Teams already knocked out in the play-offs — a pick of one is a miss. */
  eliminated_team_ids: string[];
  /** Teams that reached the R32 bracket; a pick outside this set never made it
   *  out of the group → also a miss (once the bracket is seeded). */
  qualified_team_ids: string[];
  categories: RevealCat[];
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

type PickState = "hit" | "miss" | "pending";
/** hit = advanced (green); miss = out — knocked out, never qualified, or the round
 *  finished without it (red); pending = still in the running (neutral). Only
 *  meaningful once the category has at least one confirmed outcome. */
function pickState(it: RevealItem, cat: RevealCat, isOut: (teamId: string) => boolean): PickState {
  if (!cat.settled) return "pending";
  if (isHit(it, cat.actual_items)) return "hit";
  if (it.team_id && isOut(it.team_id)) return "miss";
  return cat.complete ? "miss" : "pending";
}
const pickChipClass = (s: PickState) => (s === "hit" ? "chip-gold" : s === "miss" ? "chip-miss" : "");

/** Heading for the actual-outcome row — never "Верно" (reads as the viewer's own
 *  correct picks). It's the global result; partial knockout sets show a count. */
function actualLabel(cat: RevealCat): string {
  if (cat.item_type === "PLAYER") return "Бомбардир";
  const base = "Прошли дальше";
  return cat.complete ? base : `${base} · ${cat.actual_items?.length ?? 0} из ${cat.item_count}`;
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
  // A team is definitively out if it lost a play-off match OR (once the R32
  // bracket is seeded) it isn't in it — i.e. it never got out of the group.
  const isOut = useMemo(() => {
    const eliminated = new Set(data?.eliminated_team_ids ?? []);
    const qualified = new Set(data?.qualified_team_ids ?? []);
    return (teamId: string) => eliminated.has(teamId) || (qualified.size > 0 && !qualified.has(teamId));
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
            <PersonView data={data} people={people} selectedId={selectedId} meId={boot.participant.id} onPick={setPicked} isOut={isOut} />
          ) : (
            <CategoryView data={data} isOut={isOut} />
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
  isOut,
}: {
  data: RevealResp;
  people: Array<{ id: string; name: string }>;
  selectedId: string | null;
  meId: string;
  onPick: (id: string) => void;
  isOut: (teamId: string) => boolean;
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
                    <span key={i} className={`chip ${pickChipClass(pickState(it, c, isOut))}`}>
                      {it.code && <span className="tflag" style={{ fontSize: 14 }}>{flag(it.code)}</span>}
                      {itemLabel(it)}
                    </span>
                  ))
                : <span className="faint" style={{ fontSize: 13 }}>не заполнено</span>}
            </div>
            {c.settled && c.actual_items && (
              <div className="row wrap gap-6 mt-12" style={{ alignItems: "center" }}>
                <span className="faint" style={{ fontSize: 12 }}>{actualLabel(c)}:</span>
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

function CategoryView({ data, isOut }: { data: RevealResp; isOut: (teamId: string) => boolean }) {
  const [catId, setCatId] = useState<string | null>(null);
  // Resolve against the live list every render so a not-yet-chosen (null) or
  // stale id always falls back to the first category — the view can never go
  // blank if categories load after first paint or reorder.
  const active = data.categories.find((c) => c.category_id === catId) ?? data.categories[0];
  if (!active) return null;
  return (
    <div className="stack gap-12">
      <select className="input" value={active.category_id} onChange={(e) => setCatId(e.target.value)} aria-label="Категория">
        {data.categories.map((c) => (
          <option key={c.category_id} value={c.category_id}>{c.name_ru}</option>
        ))}
      </select>
      {[active].map((c) => (
        <section key={c.category_id} className="card card-pad">
          <div className="row between">
            <div className="section-title" style={{ fontSize: 16 }}>{c.name_ru}</div>
            <span className={`chip ${!c.settled ? "chip-locked" : c.complete ? "chip-open" : "chip-gold"}`}>
              {!c.settled ? "ожидает" : c.complete ? "подсчитано" : "идёт"} · {c.points_per_correct} очк./шт
            </span>
          </div>
          {c.settled && c.actual_items && (
            <div className="row wrap gap-6 mt-12">
              <span className="faint" style={{ fontSize: 12 }}>{actualLabel(c)}:</span>
              {c.actual_items.map((it, i) => (
                <span key={i} className="chip chip-gold">{itemText(it)}</span>
              ))}
            </div>
          )}
          {c.settled && c.item_type === "TEAM" && (
            <div className="faint mt-8" style={{ fontSize: 11 }}>
              у каждого: <span style={{ color: "var(--gold)" }}>прошли</span> ·{" "}
              <span style={{ color: "var(--coral)", textDecoration: "line-through" }}>вылетели</span> ·{" "}
              обычным — ещё в игре
            </div>
          )}
          <div className="stack mt-12">
            {c.participants.map((p) => (
              <div key={p.participant_id} className="lb-row" style={{ gridTemplateColumns: "108px 1fr auto", gap: 10, padding: "10px 0", alignItems: "start" }}>
                <span className="lb-name" style={{ fontSize: 13 }}>{p.display_name}</span>
                <span className="faint" style={{ fontSize: 12, lineHeight: 1.6 }}>
                  {p.items.length
                    ? p.items.map((it, i) => (
                        <span key={i}>
                          <PickInline it={it} cat={c} isOut={isOut} />
                          {i < p.items.length - 1 ? ", " : ""}
                        </span>
                      ))
                    : "—"}
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

/** One pick rendered inline in a comma list: gold if advanced, red+struck if out,
 *  inherited faint if still in the running. */
function PickInline({ it, cat, isOut }: { it: RevealItem; cat: RevealCat; isOut: (teamId: string) => boolean }) {
  const s = pickState(it, cat, isOut);
  const style =
    s === "hit"
      ? { color: "var(--gold)" }
      : s === "miss"
        ? { color: "var(--coral)", textDecoration: "line-through" as const }
        : undefined;
  return <span style={style}>{itemText(it)}</span>;
}
