import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { getDay, putDay } from "../backend/features/days/db";
import { emptyDay } from "../shared/days/model";

function testDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE days (date TEXT PRIMARY KEY, doc TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE exercise_log (date TEXT, section TEXT, name TEXT, name_key TEXT, detail TEXT, ord INTEGER, exercise_id TEXT);
    CREATE TABLE exercise_catalog (id TEXT PRIMARY KEY, name TEXT, name_key TEXT);
    CREATE TABLE garmin_links (source_key TEXT PRIMARY KEY, date TEXT NOT NULL, target_kind TEXT NOT NULL, target_id TEXT);
  `);
  type Bound = { sql: string; args: unknown[] };
  const prepare = (sql: string, args: unknown[] = []) => ({
    sql, args,
    bind(...values: unknown[]) { return prepare(sql, values); },
    async first() { return sqlite.prepare(sql).get(...args as []) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args as []) }; },
    async run() { return { meta: { changes: sqlite.prepare(sql).run(...args as []).changes } }; },
  });
  const db = {
    prepare,
    async batch(statements: Bound[]) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map(({ sql, args }) => ({ meta: { changes: sqlite.prepare(sql).run(...args as []).changes } }));
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1Database;
  return { db, sqlite };
}

describe("atomic day saves", () => {
  it("lets one writer win each revision and keeps the exercise index with the winner", async () => {
    const { db, sqlite } = testDb();
    const date = "2026-09-28";
    const day = (name: string, calories: number) => ({
      ...emptyDay(date), morning: name,
      activities: [{ id: name, exerciseId: "seed:0033", comment: "", result: { minutes: 20, calories } }],
    });
    const writePair = async (base: string | null) => {
      const results = await Promise.all([putDay(db, date, day("first", 20), base), putDay(db, date, day("second", 30), base)]);
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      const winner = (await getDay(db, date))!;
      expect(results.find((result) => !result.ok)).toMatchObject({ current: winner });
      const log = sqlite.prepare("SELECT detail FROM exercise_log WHERE date = ?").all(date);
      expect(log).toEqual([{ detail: JSON.stringify(winner.doc.activities[0].result) }]);
      return winner;
    };

    const first = await writePair(null);
    const second = await writePair(first.updatedAt);
    expect(second.updatedAt).not.toBe(first.updatedAt);
    expect(await putDay(db, date, emptyDay(date), first.updatedAt)).toMatchObject({ ok: false, current: second });
    expect(sqlite.prepare("SELECT count(*) AS count FROM exercise_log").get()).toEqual({ count: 1 });
    expect(await putDay(db, date, emptyDay(date), second.updatedAt)).toEqual({ ok: true, updatedAt: null });
    expect(await getDay(db, date)).toBeNull();
    expect(sqlite.prepare("SELECT count(*) AS count FROM exercise_log").get()).toEqual({ count: 0 });
    sqlite.close();
  });

  it("keeps Garmin links and ignores in sync with accepted day revisions", async () => {
    const { db, sqlite } = testDb();
    const date = "2026-09-28";
    const sourceKey = "garmin:1:2026-09-28T00:00:00.000Z:0";
    const linked = { ...emptyDay(date), activities: [{ id: "run", exerciseId: "seed:0033", comment: "", garminSourceKey: sourceKey, result: { minutes: 20, calories: 172 } }] };
    const first = await putDay(db, date, linked, null);
    expect(first.ok).toBe(true);
    expect(sqlite.prepare("SELECT * FROM garmin_links").all()).toEqual([{ source_key: sourceKey, date, target_kind: "activity", target_id: "run" }]);
    const ignored = { ...emptyDay(date), ignoredGarminSourceKeys: [sourceKey] };
    expect(await putDay(db, date, ignored, null)).toMatchObject({ ok: false });
    expect(sqlite.prepare("SELECT target_kind FROM garmin_links").all()).toEqual([{ target_kind: "activity" }]);
    const second = await putDay(db, date, ignored, first.ok ? first.updatedAt : null);
    expect(second.ok).toBe(true);
    expect(sqlite.prepare("SELECT * FROM garmin_links").all()).toEqual([{ source_key: sourceKey, date, target_kind: "ignored", target_id: null }]);
    expect((await getDay(db, date))?.doc.ignoredGarminSourceKeys).toEqual([sourceKey]);
    expect(await putDay(db, date, emptyDay(date), second.ok ? second.updatedAt : null)).toEqual({ ok: true, updatedAt: null });
    expect(sqlite.prepare("SELECT * FROM garmin_links").all()).toEqual([]);
    sqlite.close();
  });
});
