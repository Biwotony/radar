BEGIN;

ALTER TABLE alerts_sent
  ADD COLUMN status TEXT NOT NULL DEFAULT 'sent'
    CHECK (status IN ('pending', 'sent', 'failed')),
  ADD COLUMN provider_message_id TEXT,
  ADD COLUMN last_error TEXT,
  ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE alerts_sent
  ALTER COLUMN status SET DEFAULT 'pending',
  ALTER COLUMN sent_at DROP DEFAULT,
  ALTER COLUMN sent_at DROP NOT NULL;

ALTER TABLE alerts_sent
  ADD CONSTRAINT alerts_sent_user_search_listing_unique
  UNIQUE (user_id, saved_search_id, listing_id);

CREATE INDEX idx_alerts_sent_status ON alerts_sent(status);

COMMIT;
