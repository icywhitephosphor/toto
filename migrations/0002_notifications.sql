-- Deadline-reminder dedup: one row per (match, participant, threshold) once a
-- "no bet yet" DM has been sent for that threshold bucket (6h/3h/1h/15m).
CREATE TABLE notification_log (
  match_id        uuid NOT NULL REFERENCES matches(id),
  participant_id  uuid NOT NULL REFERENCES participants(id),
  threshold_min   int  NOT NULL,
  sent_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, participant_id, threshold_min)
);
