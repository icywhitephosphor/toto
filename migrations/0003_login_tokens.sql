-- Magic browser-login links: a logged-in (Telegram) user mints a one-time,
-- short-lived token; opening /api/auth/browser-login?token=... in any browser
-- sets the normal session cookie. Only the SHA-256 hash is stored.
CREATE TABLE login_tokens (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE INDEX login_tokens_expires_idx ON login_tokens (expires_at);
