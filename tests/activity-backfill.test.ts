import { readFileSync, existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

describe("activity D1 backfill", () => {
  it("indexes legacy activity names and results without rewriting day documents", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(readFileSync("migrations/0001_init.sql", "utf8"));
      db.exec(readFileSync("migrations/0002_exercise_catalog.sql", "utf8"));
      const doc = JSON.stringify({ v: 3, date: "2026-09-28", activities: [
        { id: "run", name: " Trail   run ", minutes: 35, calories: 280, notes: "Steady" },
        { id: "blank", name: "", minutes: 5, calories: null, notes: "" },
      ] });
      db.prepare("INSERT INTO days VALUES (?, ?, ?)").run("2026-09-28", doc, "2026-09-28T00:00:00Z");
      db.prepare("INSERT INTO exercise_log (date, section, name, name_key, detail, ord, exercise_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run("2026-09-28", "main", "Squat", "squat", "{}", 0, "legacy:squat");

      if (existsSync("migrations/0003_activity_catalog.sql")) db.exec(readFileSync("migrations/0003_activity_catalog.sql", "utf8"));

      expect(db.prepare("SELECT id, name, name_key FROM exercise_catalog ORDER BY id").all()).toEqual([
        { id: "legacy:activity", name: "Activity", name_key: "activity" },
        { id: "legacy:trail run", name: "Trail run", name_key: "trail run" },
      ]);
      expect(db.prepare("SELECT section, name, detail, ord, exercise_id FROM exercise_log WHERE section = 'activity' ORDER BY ord").all()).toEqual([
        { section: "activity", name: "Trail run", detail: JSON.stringify({ minutes: 35, calories: 280 }), ord: 1, exercise_id: "legacy:trail run" },
        { section: "activity", name: "Activity", detail: JSON.stringify({ minutes: 5, calories: null }), ord: 2, exercise_id: "legacy:activity" },
      ]);
      expect(db.prepare("SELECT doc FROM days WHERE date = ?").get("2026-09-28")).toEqual({ doc });
    } finally {
      db.close();
    }
  });
});
