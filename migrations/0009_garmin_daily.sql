-- Tracks Garmin's daily active calories used to fill a finished day's totalCalories.
-- written_calories is the value last put into the day; a different day value was typed and is kept.
CREATE TABLE garmin_daily (
  date             TEXT PRIMARY KEY,
  written_calories INTEGER,
  settled          INTEGER NOT NULL DEFAULT 0,
  fetched_at       TEXT NOT NULL
);
