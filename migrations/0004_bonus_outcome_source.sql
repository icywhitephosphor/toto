-- 0004: auto-derived vs manual bonus outcomes.
--
-- recomputeAll now auto-derives the actual outcome of every derivable bonus
-- category straight from match results (group winners + knockout participants),
-- writing source='AUTO' rows. The admin settle endpoint writes source='MANUAL'.
-- Auto-derivation only ever (re)writes AUTO rows and never touches MANUAL, so a
-- manual settle is a sticky override the organizer can later clear back to auto.
--
-- DEFAULT 'MANUAL' is the safe direction: an outcome row of unknown provenance
-- is treated as a pinned override, never silently wiped by auto-derivation.
ALTER TABLE bonus_outcomes
  ADD COLUMN source text NOT NULL DEFAULT 'MANUAL'
  CHECK (source IN ('AUTO', 'MANUAL'));
