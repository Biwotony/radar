BEGIN;

CREATE TABLE listing_source_items (
  listing_id BIGINT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  source_item_id BIGINT NOT NULL REFERENCES source_items(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (listing_id, source_item_id)
);

CREATE INDEX idx_listing_source_items_source_item_id
  ON listing_source_items(source_item_id);

INSERT INTO listing_source_items (listing_id, source_item_id)
SELECT id, source_item_id
FROM listings
WHERE source_item_id IS NOT NULL;

ALTER TABLE listings
  DROP COLUMN source_item_id;

COMMIT;
