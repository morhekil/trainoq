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
});
