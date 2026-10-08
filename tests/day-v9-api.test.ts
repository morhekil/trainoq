import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createTRPCClient, httpLink } from "@trpc/client";
import { expect, it } from "vitest";
import worker from "../backend/index";
import { importGarminSummaries } from "../backend/features/garmin/db";
import type { AppRouter } from "../backend/router";
import { addEventEntry, emptyDay, type DayDoc } from "../shared/days/model";
import type { V8DayDoc } from "../shared/days/migrate";

function migratedD1() {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync("migrations").sort()) sqlite.exec(readFileSync(`migrations/${file}`, "utf8"));
  type Bound = { sql: string; args: unknown[] };
  const prepare = (sql: string, args: unknown[] = []) => ({
    sql, args,
    bind(...values: unknown[]) { return prepare(sql, values); },
    async first() { return sqlite.prepare(sql).get(...args as []) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args as []) }; },
    async run() { return { meta: { changes: sqlite.prepare(sql).run(...args as []).changes } }; },
  });
  const db = { prepare, async batch(statements: Bound[]) {
    sqlite.exec("BEGIN");
    try {
      const results = statements.map(({ sql, args }) => sql.startsWith("SELECT")
        ? { results: sqlite.prepare(sql).all(...args as []) }
        : { meta: { changes: sqlite.prepare(sql).run(...args as []).changes } });
      sqlite.exec("COMMIT");
      return results;
    } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } } as unknown as D1Database;
  return { db, sqlite };
}

const walk = "seed:0033", run = "seed:0170", tennis = "seed:0171";
const fit = "garmin:3442:2026-10-02T06:24:07.000Z";

function oct2(): DayDoc {
  const day = emptyDay("2026-10-02");
  const segments = [24, 29, 34, 39].map((minute, i) => ({ id: `part-${i}`, exerciseId: i % 2 ? run : walk, startedAt: `2026-10-02T16:${minute}:00+10:00`, result: { minutes: 5, calories: i % 2 ? 40 : 20 } }));
  addEventEntry(day, { kind: "activity", activity: { id: "walk-run", comment: "Hot", effort: "high", segments } });
  addEventEntry(day, { kind: "activity", activity: { id: "tennis", comment: "", segments: [{ id: "tennis", exerciseId: tennis, startedAt: "2026-10-02T18:00:00+10:00", result: { minutes: 60, calories: null } }] } });
  day.garminLinks = segments.map((segment, i) => ({ sourceKey: `${fit}:${i}`, target: { kind: "segment", id: segment.id } }));
  day.comments = [{ id: "back", time: "17:05", text: "Hurt on both sides", score: { metric: "Back", value: 3 } }];
  return day;
}

it("saves a v9 day through the Worker and rebuilds history and Garmin status from it", async () => {
  const { db, sqlite } = migratedD1();
  const env = { APP_PASSWORD: "test-password", DB: db } as Env;
  let cookie = "";
  const client = createTRPCClient<AppRouter>({ links: [httpLink({ url: "https://example.test/api/trpc", fetch: async (input, init) => {
    const headers = new Headers(init?.headers);
    if (cookie) headers.set("Cookie", cookie);
    const response = await worker.fetch(new Request(input, { ...init, headers }) as Parameters<typeof worker.fetch>[0], env);
    cookie = response.headers.get("Set-Cookie")?.split(";")[0] ?? cookie;
    return response;
  } })] });
  await client.auth.login.mutate({ password: "test-password" });

  const day = oct2();
  const saved = await client.days.save.mutate({ date: day.date, doc: day, base: null });
  expect(saved.ok).toBe(true);
  expect((await client.days.get.query(day.date)).doc).toEqual(day);

  expect(sqlite.prepare("SELECT exercise_id, section, detail FROM exercise_log WHERE date = ? ORDER BY ord").all(day.date)).toEqual([
    { exercise_id: walk, section: "activity", detail: JSON.stringify({ minutes: 10, calories: 40, effort: "high", segments: 2, with: [run] }) },
    { exercise_id: run, section: "activity", detail: JSON.stringify({ minutes: 10, calories: 80, effort: "high", segments: 2, with: [walk] }) },
    { exercise_id: tennis, section: "activity", detail: JSON.stringify({ minutes: 60, calories: null }) },
  ]);
  expect(await client.exercises.history.query({ exerciseId: run })).toEqual([
    { date: day.date, section: "activity", result: { minutes: 10, calories: 80 }, effort: "high", segments: 2, with: [walk] },
  ]);
  expect(await client.exercises.history.query({ exerciseId: tennis })).toEqual([{ date: day.date, section: "activity", result: { minutes: 60, calories: null } }]);

  await importGarminSummaries(db, [{ sourceKey: `${fit}:1`, sport: "running", subSport: null, title: "Run", startUtc: "2026-10-02T06:29:00.000Z",
    localDate: day.date, offsetMinutes: 600, timerSeconds: 300, elapsedSeconds: 300, activeCalories: 40 }]);
  expect((await client.garmin.list.query({ from: day.date, to: day.date, includeLinked: true })).items)
    .toMatchObject([{ sourceKey: `${fit}:1`, status: "activity", targetId: "walk-run", decisionDate: day.date }]);

  const v8: V8DayDoc = { v: 8, date: day.date, comments: [{ id: "c", time: "07:00", text: "From a cached client" }], events: [], ignoredGarminSourceKeys: [], totalCalories: null };
  await expect(client.days.save.mutate({ date: day.date, doc: v8, base: saved.ok ? saved.updatedAt : null })).rejects.toMatchObject({ data: { code: "PRECONDITION_FAILED" } });
  expect((await client.days.get.query(day.date)).doc).toEqual(day);
  expect((await client.days.save.mutate({ date: "2026-10-03", doc: { ...v8, date: "2026-10-03" }, base: null })).ok).toBe(true);
  expect((await client.days.get.query("2026-10-03")).doc).toMatchObject({ v: 9, comments: v8.comments });
  sqlite.close();
});
