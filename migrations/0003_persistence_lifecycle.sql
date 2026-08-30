BEGIN;

ALTER TABLE source_items
  ADD COLUMN consecutive_misses INTEGER NOT NULL DEFAULT 0
  CHECK (consecutive_misses >= 0);

-- Snapshots represent observations over time, including unchanged repeat sightings.
-- Keep content_hash for change detection, but do not deduplicate identical fetches.
ALTER TABLE source_snapshots
  DROP CONSTRAINT source_snapshots_source_item_id_content_hash_key;

CREATE INDEX idx_source_snapshots_source_item_hash
  ON source_snapshots(source_item_id, content_hash);

CREATE INDEX idx_source_items_source_misses
  ON source_items(source_id, consecutive_misses);

COMMIT;
