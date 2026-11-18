CREATE TABLE withings_oauth (state_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
CREATE TABLE withings_connection (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  user_id TEXT NOT NULL,
  encrypted_tokens TEXT NOT NULL,
  last_update INTEGER NOT NULL DEFAULT 0,
  next_offset INTEGER NOT NULL DEFAULT 0,
  sweep_update INTEGER,
  last_sync_at TEXT,
  last_error TEXT,
  lock_until INTEGER
);
CREATE TABLE withings_measurements (
  source_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  measured_at TEXT NOT NULL,
  local_date TEXT NOT NULL,
  measurement TEXT NOT NULL
);
CREATE INDEX withings_measurements_time ON withings_measurements(measured_at, source_id);
CREATE INDEX withings_measurements_day ON withings_measurements(local_date);
