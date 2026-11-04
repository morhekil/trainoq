-- Set when the Worker auto-imports a recording into its day, so one later unlinked or deleted is not imported again.
ALTER TABLE garmin_activities ADD COLUMN auto_imported_at TEXT;
