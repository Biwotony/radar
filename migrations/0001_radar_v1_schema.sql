BEGIN;

CREATE TYPE listing_lifecycle_state AS ENUM (
  'NEW',
  'ACTIVE',
  'POSSIBLY_STALE',
  'INACTIVE',
  'REMOVED'
);

CREATE TABLE sources (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  domain TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE source_items (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id BIGINT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_id, external_id)
);

CREATE TABLE source_snapshots (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_item_id BIGINT NOT NULL REFERENCES source_items(id) ON DELETE CASCADE,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  content_hash TEXT NOT NULL,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_item_id, content_hash)
);

CREATE TABLE listings (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_item_id BIGINT REFERENCES source_items(id) ON DELETE SET NULL,
  lifecycle_state listing_lifecycle_state NOT NULL DEFAULT 'NEW',
  extracted_facts JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_confirmed_active_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE users (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE saved_searches (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  university TEXT NOT NULL CHECK (university IN ('frankfurt_uas', 'goethe')),
  max_total_monthly_rent INTEGER NOT NULL CHECK (max_total_monthly_rent > 0),
  move_in_month DATE,
  housing_types TEXT[] NOT NULL DEFAULT ARRAY['dorm', 'wg', 'studio']::TEXT[],
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE alerts_sent (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  saved_search_id BIGINT NOT NULL REFERENCES saved_searches(id) ON DELETE CASCADE,
  listing_id BIGINT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  alert_key TEXT NOT NULL UNIQUE,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE submissions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  review_notes TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  listing_id BIGINT REFERENCES listings(id) ON DELETE SET NULL,
  event_name TEXT NOT NULL CHECK (
    event_name IN (
      'search_completed',
      'listing_impression',
      'listing_opened',
      'source_clicked',
      'alert_created',
      'alert_sent',
      'applied_reported'
    )
  ),
  properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_source_items_source_id ON source_items(source_id);
CREATE INDEX idx_source_items_last_seen_at ON source_items(last_seen_at);
CREATE INDEX idx_source_snapshots_source_item_id_fetched_at ON source_snapshots(source_item_id, fetched_at DESC);
CREATE INDEX idx_listings_lifecycle_state ON listings(lifecycle_state);
CREATE INDEX idx_listings_last_confirmed_active_at ON listings(last_confirmed_active_at DESC);
CREATE INDEX idx_saved_searches_user_id_active ON saved_searches(user_id, is_active);
CREATE INDEX idx_alerts_sent_listing_id ON alerts_sent(listing_id);
CREATE INDEX idx_submissions_status ON submissions(status);
CREATE INDEX idx_events_event_name_created_at ON events(event_name, created_at DESC);

INSERT INTO sources (name, domain, type, status, policy)
VALUES
  (
    'wohnraum-gesucht.de',
    'wohnraum-gesucht.de',
    'live_portal',
    'active',
    '{"crawlIntervalMinutes":30,"missingBeforeStale":2,"missingBeforeInactive":6,"explicit404MeansRemoved":true}'::jsonb
  ),
  (
    'wg-gesucht.de',
    'wg-gesucht.de',
    'live_portal',
    'disabled',
    '{"crawlIntervalMinutes":30,"missingBeforeStale":2,"missingBeforeInactive":6,"explicit404MeansRemoved":true}'::jsonb
  );

COMMIT;
