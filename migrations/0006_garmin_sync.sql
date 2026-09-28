ALTER TABLE garmin_connection ADD COLUMN sync_lock_until TEXT;

CREATE TABLE garmin_downloads (
  activity_id TEXT PRIMARY KEY,
  imported_at TEXT NOT NULL
);
