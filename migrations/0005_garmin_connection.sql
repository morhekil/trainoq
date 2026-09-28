CREATE TABLE garmin_connection (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  encrypted_state TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('connected', 'mfa', 'error')),
  next_offset INTEGER NOT NULL DEFAULT 0,
  last_sync_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL
);
