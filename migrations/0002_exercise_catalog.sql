CREATE TABLE exercise_catalog (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL
);

-- Existing logged names get deterministic IDs; seed names resolve to their seed IDs in code.
INSERT OR IGNORE INTO exercise_catalog (id, name, name_key)
SELECT 'legacy:' || name_key, name, name_key FROM exercise_log GROUP BY name_key;

ALTER TABLE exercise_log ADD COLUMN exercise_id TEXT;
UPDATE exercise_log SET exercise_id = 'legacy:' || name_key;
CREATE INDEX idx_exercise_log_exercise_id ON exercise_log(exercise_id, date);
