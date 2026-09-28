CREATE TABLE garmin_activities (
  source_key TEXT PRIMARY KEY,
  summary TEXT NOT NULL,
  summary_hash TEXT NOT NULL,
  imported_at TEXT NOT NULL
);

CREATE TABLE garmin_links (
  source_key TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('session', 'activity', 'ignored')),
  target_id TEXT
);
CREATE INDEX idx_garmin_links_date ON garmin_links(date);
