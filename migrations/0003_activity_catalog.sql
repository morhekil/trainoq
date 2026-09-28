-- Index old name-based activities without changing their day documents.
CREATE TABLE _activity_backfill AS
WITH RECURSIVE raw AS (
  SELECT d.date, CAST(a.key AS INTEGER) AS idx,
    json_extract(a.value, '$.name') AS raw_name,
    json_extract(a.value, '$.minutes') AS minutes,
    json_extract(a.value, '$.calories') AS calories,
    COALESCE((SELECT MAX(ord) + 1 FROM exercise_log WHERE date = d.date), 0) AS base_ord
  FROM days AS d, json_each(d.doc, '$.activities') AS a
  WHERE json_extract(d.doc, '$.v') < 4
), cleaned AS (
  SELECT date, idx, minutes, calories, base_ord,
    TRIM(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(raw_name, ''), CHAR(9), ' '), CHAR(10), ' '), CHAR(13), ' '), CHAR(160), ' ')) AS name
  FROM raw
), collapsed AS (
  SELECT * FROM cleaned
  UNION ALL
  SELECT date, idx, minutes, calories, base_ord, REPLACE(name, '  ', ' ')
  FROM collapsed WHERE INSTR(name, '  ') > 0
)
SELECT date, idx, minutes, calories, base_ord,
  CASE WHEN name = '' THEN 'Activity' ELSE name END AS name,
  LOWER(CASE WHEN name = '' THEN 'Activity' ELSE name END) AS name_key
FROM collapsed WHERE INSTR(name, '  ') = 0;

INSERT OR IGNORE INTO exercise_catalog (id, name, name_key)
SELECT 'legacy:' || name_key, name, name_key FROM _activity_backfill ORDER BY date, idx;

INSERT INTO exercise_log (date, section, name, name_key, detail, ord, exercise_id)
SELECT date, 'activity', name, name_key,
  JSON_OBJECT('minutes', minutes, 'calories', calories), base_ord + idx, 'legacy:' || name_key
FROM _activity_backfill;

DROP TABLE _activity_backfill;
