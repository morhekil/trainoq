-- One JSON document per calendar day. The document is the source of truth.
CREATE TABLE days (
  date       TEXT PRIMARY KEY,           -- YYYY-MM-DD (local date of the athlete)
  doc        TEXT NOT NULL,              -- DayDoc JSON
  updated_at TEXT NOT NULL               -- server-assigned ISO timestamp, used for conflict detection
);

-- Derived index of every exercise logged, rebuilt from the day document on each save.
-- Powers exercise search, "last time" hints and future progress charts.
CREATE TABLE exercise_log (
  date     TEXT NOT NULL,
  section  TEXT NOT NULL,                -- warmup | main | cooldown
  name     TEXT NOT NULL,
  name_key TEXT NOT NULL,                -- lower-cased, whitespace-collapsed name
  detail   TEXT NOT NULL,                -- JSON: {sets:[...]} for main, {reps:"..."} otherwise
  ord      INTEGER NOT NULL
);
CREATE INDEX idx_exercise_log_name ON exercise_log(name_key, date);
CREATE INDEX idx_exercise_log_date ON exercise_log(date);
