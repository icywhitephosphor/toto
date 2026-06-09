# 01 — Context & Requirements

## 1. Problem statement

A group of **21 friends** runs a World Cup betting pool. Today it lives in a shared Excel/Google Sheet
(`тотоЧМ2026.xlsx`): people send predictions to the organizer in Telegram DMs, and the organizer keys
them in and tallies points by hand. This has three problems:

1. **No identity / privacy.** Anyone editing the sheet can see (and change) everyone's bets. Predictions
   should be secret until their deadline, and only the owner should edit their own.
2. **Manual, error-prone scoring.** Points, the ×2 rule, the penalty "+1 goal" convention, and the
   multi-level tie-breaks are fiddly to compute by hand for 104 matches × 21 people.
3. **No live table.** Standings should update as matches are played.

We want a small **web app**: Telegram login, per-person bet entry, automatic scoring from a live feed, a
live leaderboard, and a **Google Sheets export** so the whole group can audit everything transparently.

## 2. Actors

| Actor | Description | Capabilities |
|-------|-------------|--------------|
| **Participant** | One of the 21 friends | Log in with Telegram; claim their name once; enter/edit **their own** bonus and match bets before each deadline; view the leaderboard and (after deadlines) everyone's revealed bets |
| **Organizer / Admin** | The person who runs the pool today (you, ione) | Everything a participant can do **plus**: import/refresh fixtures, **confirm play-off results**, manually override any result, trigger recompute and Sheets export, fix a wrong name-binding |
| **Viewer (optional)** | A friend who only watches | Read-only leaderboard and revealed bets |
| **System (jobs)** | Scheduled backend tasks | Poll the football feed, recompute scores, push the Sheets export |
| **Football data provider** | football-data.org (free) + manual override | Supplies fixtures, statuses, scores incl. extra-time/penalties |
| **Telegram** | Identity provider | Authenticates each person; the bot can also send notifications |
| **Google Sheets** | Transparency mirror | Receives read-only exports |

## 3. Functional requirements

### 3.1 Identity & onboarding
- **FR-1** A person logs in with Telegram (Mini App `initData`, Login Widget as fallback).
- **FR-2** On first login the person **claims** exactly one participant from the existing 21-person
  roster; the Telegram account is then bound to that participant. One Telegram ↔ one participant.
- **FR-3** Only the admin can re-bind a participant (e.g. someone claimed the wrong name).

### 3.2 Bonus bets (pre-tournament)
- **FR-4** A participant submits the seven bonus categories (§2.3 of `00`): 12 group winners, 16 R16
  teams, 8 QF teams, 4 SF teams, 2 finalists, 1 champion, 1 top-scorer name.
- **FR-5** Each category enforces the **exact count** and **no duplicate teams** within a category.
- **FR-6** Bonus bets are editable until **2026-06-10 23:00 MSK**, then permanently locked.
- **FR-7** Until the lock, a participant sees only their own bonus bets; after the lock, everyone's
  bonus bets become visible.

### 3.3 Match bets (whole tournament)
- **FR-8** For each of the 104 matches a participant predicts a score.
- **FR-9** For the 32 play-off matches (`R32…FINAL`) a participant may toggle **×2** per match.
- **FR-10** Group-stage bets allow draws; play-off bets are on the **toto final score** (decisive) — see
  the open question in §7 on how draws are handled in the UI.
- **FR-11** Each match bet is editable until **kickoff − 3 hours**, then locked.
- **FR-12** "Save" persists a batch; if some matches in the batch are already locked, save the open ones
  and report the rejected ones (partial save — see `06`).
- **FR-13** A participant sees only their own match bet until that match's deadline; afterwards the
  match's bets become visible to all.
- **FR-14** No bet for a match → 0 points for that match (no penalty unless ×2 was set, which can't be
  set without a bet).

### 3.4 Scoring & leaderboard
- **FR-15** Scoring follows `05-scoring-engine.md` exactly, including the non-stacking score/outcome
  rule, the ×2 rule (incl. the negative case), and the penalty "+1 goal" canonical score.
- **FR-16** Bonus categories settle at their defined trigger stages (§2.3 of `00`), so the leaderboard
  reflects bonus points progressively, not all at the end.
- **FR-17** The leaderboard ranks participants by the four-level tie-break (§2.4 of `00`) and shows a
  per-player breakdown (match pts, bonus pts, play-off match pts, key bonus pts) and the prize for the
  top 5 places.
- **FR-18** The leaderboard updates "live" (near-real-time) as results come in.

### 3.5 Results ingestion
- **FR-19** Fixtures (teams, kickoff times, venues, statuses) are imported from the provider and
  refreshable.
- **FR-20** Group-stage results may auto-settle from the provider once a match is final.
- **FR-21** **Play-off results must be confirmed by the admin** before they score (canonical score +
  ×2 stakes). The admin can also override any result with a reason.
- **FR-22** Bracket placeholders (e.g. "Winner Group A", "3rd Group C/E/F/H/I") resolve to real teams as
  the group stage and each round complete (see `03`).

### 3.6 Export & transparency
- **FR-23** All participants, matches, results, (revealed) bets, the leaderboard, and a scoring audit are
  exported to Google Sheets.
- **FR-24** The export **must not leak un-revealed bets**: a private full export for the admin, and a
  public sheet that only shows bets after their deadline. See `09`.

### 3.7 Notifications (optional, nice-to-have)
- **FR-25** The Telegram bot may DM reminders (24 h / 3 h before the bonus deadline; 30 min before a
  match deadline) and result/standing updates.

## 4. Non-functional requirements

| Area | Requirement | Target for this pool |
|------|-------------|----------------------|
| **Scale** | Concurrent users | ≤ ~21 (call it 50 for headroom); 104 matches; ~2,200 match bets + 21×~44 bonus items total |
| **Latency** | Bet save, page load | < 300 ms p95; leaderboard freshness within ~1–3 min of a result is fine |
| **Correctness** | Scoring | Deterministic, reproducible, unit-tested against every rule example; full recompute must be idempotent |
| **Fairness** | Bet secrecy & deadlines | Enforced **server-side**; no client trust; bets hidden until deadline; immutable after |
| **Auditability** | Disputes | Every bet write and every result change is logged (who/when/before/after) |
| **Availability** | Uptime | Best-effort; a few minutes of downtime is acceptable for a friends' pool |
| **Cost** | Hosting + data | ~$0–5 / month on free tiers |
| **Security** | Threat model | Trusted small group; main threats are *peeking at others' bets* and *impersonation* — not external attackers (see `12`) |
| **Maintainability** | One developer | One codebase, minimal moving parts; Track B complexity deferred |
| **Time** | Build window | Bonus deadline is imminent — MVP must prioritize bonus entry + lock (see `13`) |

## 5. Constraints

- **Free data tier** chosen → poll budget matters (football-data.org free = 10 req/min; see `08`).
- **MSK** is the canonical display zone for deadlines; venues span US/Canada/Mexico zones (store UTC).
- **Telegram** is the only identity provider (no email/password).
- Roster is **fixed at 21** known people; this is effectively an allow-list, which simplifies security.
- Money (2,000 ₽ stake, prize pool) is handled **offline**; the app ranks and shows prizes but does not
  process payments (see open question §7.5).

## 6. The rules, formalized

This is the authoritative restatement of the rules from `тотоЧМ2026.xlsx` / the instruction text. The
executable version lives in `05-scoring-engine.md`.

### 6.1 Match bets
Let a bet be `(h, a, x2)` = predicted home goals, away goals, and the ×2 flag (×2 only allowed in
play-off stages). Let the official **toto result** be `(H, A)` (for play-offs, after the penalty "+1"
adjustment — see §6.3). Let `outcome(x, y)` ∈ {HOME, DRAW, AWAY}. Let `Pe`, `Po` be the stage's
exact-score and outcome points.

```
exact   := (h == H) and (a == A)
correctOutcome := outcome(h, a) == outcome(H, A)

if not x2:
    if exact:           points =  Pe
    elif correctOutcome: points = Po
    else:               points =  0
if x2 (play-off only):
    if exact:           points =  2 * Pe
    elif correctOutcome: points = 2 * Po
    else:               points = -Pe        # note: the UN-doubled exact-score points, negative
```

Score points and outcome points **never stack**. There is **no limit** on the number of ×2 bets.

### 6.2 Bonus bets
Each category `c` is a set of predicted teams `Bc` (or a single player for `TOP_SCORER`) with
per-correct points `Pc`. After settlement the actual set is `Ac`. Points = `|Bc ∩ Ac| * Pc`
(for `TOP_SCORER`: `Pc` if the predicted player is the official top scorer, else 0 — subject to the
tie ruling in §7.1).

### 6.3 Canonical play-off ("toto") score
```
regH, regA = goals after regulation + extra time
if penalty shootout occurred:
    if penWinner == HOME: totoH, totoA = regH + 1, regA
    else:                 totoH, totoA = regH,     regA + 1
else:
    totoH, totoA = regH, regA
```
So a play-off `(H, A)` is always decisive. (Example: ET 2:2, pens 5:3 home → toto 3:2.)

### 6.4 Tie-breakers
Rank by, in order: (1) total points ↓, (2) play-off **match** points ↓, (3) key-bonus points ↓
(`QF_PARTICIPANT+SF_PARTICIPANT+FINALIST+CHAMPION`), (4) "по росту" — manual organizer order, with a
stable deterministic fallback so the table never flickers.

### 6.5 Worked examples (must all pass as tests — see `05`)
| Match | Stage | Bet | ×2 | Result | Points | Why |
|-------|-------|-----|:--:|--------|:------:|-----|
| Curaçao–Ecuador | GROUP | 0:4 | no | 0:3 | **1** | outcome right (away win), score wrong |
| Czechia–Bosnia | R32 | 2:1 | yes | 3:1 | **4** | outcome right ×2 = 2×2 |
| Türkiye–Belgium | R16 | 0:2 | yes | 1:0 | **−4** | both wrong, ×2 → −(exact pts)= −4 |
| Türkiye–Belgium | R16 | 2:0 | yes | 1:0 | **6** | outcome right ×2 = 3×2 |
| Türkiye–Belgium | R16 | 1:0 | yes | 1:0 | **8** | exact ×2 = 4×2 |
| Argentina–Portugal | QF | 2:1 | no | 1:2 | **0** | outcome wrong, no ×2 |
| England–Germany | SF | 2:1 | yes | 2:1 | **14** | exact ×2 = 7×2 |
| France–Argentina | FINAL | 0:3 | yes | 0:3 | **20** | exact ×2 = 10×2 |
| France–Argentina | FINAL | 2:1 | yes | 0:3 | **−10** | both wrong ×2 → −(exact pts)= −10 |

## 7. Open questions for the organizer

These need a ruling from you; defaults are proposed so the build isn't blocked.

1. **Top-scorer ties.** If several players finish level on goals (FIFA's Golden Boot then uses assists,
   then fewer minutes), does a participant who picked **any** co-leader get the 7 points, or only the
   official Golden Boot winner? *Proposed default: the official FIFA Golden Boot winner only; the admin
   sets the winning player at settlement.*
2. **Prizes on an unbroken tie.** The four tie-breakers end in "по росту :)". For real money, what
   happens if two people are still tied? *Proposed default: split the combined prize money of the tied
   places equally; "height" stays a joke for bragging rights only.*
3. **Draw predictions in play-offs.** The toto score is always decisive, so a predicted draw always
   loses the outcome. Do we (a) **block** draw scores in play-off entry, (b) allow a draw + a separate
   "who wins on penalties" pick that builds the toto score, or (c) allow draws and let them lose?
   *Proposed default: (b) — enter the regulation score, and if it's a draw, pick the penalty winner; the
   app computes the toto score. Cleanest UX and matches how people think.* (See `06` for both data shapes.)
4. **`R16_PARTICIPANT` interpretation.** We read "участники 1/8 финала" as **the 16 teams that reach the
   Round of 16** (winners of the Round of 32), settled after match 88. *Please confirm.*
5. **Money tracking.** Should the app track who has paid their 2,000 ₽ and show prize payouts, or is all
   money handled offline? *Proposed default: offline; app shows prize amounts for the top 5 only.*
6. **Late entry.** Can a new person join after the bonus deadline (match bets only, no bonus)? *Proposed
   default: no new joins after the bonus deadline.*
7. **Admin set.** Who, besides you, is an admin? *Proposed default: just you, plus one backup.*

## 8. Sources
- FIFA WC-2026 schedule/format & official final draw (group composition verified against your sheet):
  [FIFA match schedule](https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/scores-fixtures),
  [Wikipedia: 2026 FIFA World Cup](https://en.wikipedia.org/wiki/2026_FIFA_World_Cup),
  [Wikipedia: knockout stage](https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_knockout_stage).
- Rules and roster: your `тотоЧМ2026.xlsx` (sheets «правила», «команды», «бонусные ставки»).
