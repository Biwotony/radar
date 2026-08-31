BEGIN;

CREATE TABLE magic_link_tokens (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  send_error TEXT
);

CREATE INDEX idx_magic_link_tokens_user_requested
  ON magic_link_tokens(user_id, requested_at DESC);
CREATE INDEX idx_magic_link_tokens_expiry
  ON magic_link_tokens(expires_at)
  WHERE used_at IS NULL;

CREATE TABLE user_sessions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX idx_user_sessions_user_active
  ON user_sessions(user_id, expires_at DESC)
  WHERE revoked_at IS NULL;
CREATE INDEX idx_user_sessions_expiry
  ON user_sessions(expires_at)
  WHERE revoked_at IS NULL;

COMMIT;
