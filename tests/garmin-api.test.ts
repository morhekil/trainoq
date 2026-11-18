import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createTRPCClient, httpLink } from "@trpc/client";
import { expect, it } from "vitest";
import worker from "../backend/index";
import { importGarminSummaries } from "../backend/features/garmin/db";
import type { AppRouter } from "../backend/router";
import type { GarminActivitySummary } from "../shared/garmin/fit";
import { addEventEntry, dayActivities, daySessions, emptyDay } from "../shared/days/model";
import { unlinkGarmin } from "../shared/garmin/decisions";

it("lists automatically imported Garmin summaries through the authenticated Worker and keeps revisions separate", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE days (date TEXT PRIMARY KEY, doc TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE exercise_catalog (id TEXT PRIMARY KEY, name TEXT, name_key TEXT, section TEXT, aliases TEXT);
    CREATE TABLE exercise_params (exercise_id TEXT PRIMARY KEY, params TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE param_templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, params TEXT NOT NULL);
    CREATE TABLE garmin_activities (source_key TEXT PRIMARY KEY, summary TEXT NOT NULL, summary_hash TEXT NOT NULL, imported_at TEXT NOT NULL);
    CREATE TABLE garmin_links (source_key TEXT PRIMARY KEY, date TEXT NOT NULL, target_kind TEXT NOT NULL, target_id TEXT);`);
  sqlite.exec(readFileSync("migrations/0011_withings.sql", "utf8"));
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
      const results = statements.map(({ sql, args }) => ({ meta: { changes: sqlite.prepare(sql).run(...args as []).changes } }));
      sqlite.exec("COMMIT");
      return results;
    } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } } as unknown as D1Database;
  const env = { APP_PASSWORD: "test-password", DB: db } as Env;
  let cookie = "";
  const client = createTRPCClient<AppRouter>({ links: [httpLink({ url: "https://example.test/api/trpc", fetch: async (input, init) => {
    const headers = new Headers(init?.headers);
    if (cookie) headers.set("Cookie", cookie);
    const response = await worker.fetch(new Request(input, { ...init, headers }) as Parameters<typeof worker.fetch>[0], env);
    cookie = response.headers.get("Set-Cookie")?.split(";")[0] ?? cookie;
    return response;
  } })] });
  const source: GarminActivitySummary = {
    sourceKey: "garmin:123:2026-09-28T07:00:00.000Z:0", sport: "running", subSport: null,
    title: "Run", startUtc: "2026-09-28T07:00:00.000Z", localDate: "2026-09-28", offsetMinutes: 600,
    timerSeconds: 1561.339, elapsedSeconds: 1600, activeCalories: 172,
  };
  await expect(client.garmin.list.query({ from: "2026-09-28", to: "2026-09-28" })).rejects.toMatchObject({ data: { code: "UNAUTHORIZED" } });
  await expect(client.garmin.summaries.query({ sourceKeys: [source.sourceKey] })).rejects.toMatchObject({ data: { code: "UNAUTHORIZED" } });
  await client.auth.login.mutate({ password: "test-password" });
  const manualImport = await worker.fetch(new Request("https://example.test/api/trpc/garmin.import", {
    method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ json: { activities: [source] } }),
  }) as Parameters<typeof worker.fetch>[0], env);
  expect(manualImport.status).toBe(404);
  expect(await importGarminSummaries(db, [source])).toEqual({ inserted: 1, unchanged: 0, updated: 0, rejected: 0 });
  expect(await importGarminSummaries(db, [source])).toEqual({ inserted: 0, unchanged: 1, updated: 0, rejected: 0 });
  const corrected = { ...source, activeCalories: 173 };
  expect(await importGarminSummaries(db, [corrected, { ...source, sourceKey: "bad" }])).toEqual({ inserted: 0, unchanged: 0, updated: 1, rejected: 1 });
  expect(await client.garmin.list.query({ from: "2026-09-28", to: "2026-09-28" })).toMatchObject({ items: [{ ...corrected, status: "pending" }], nextCursor: null });
  expect(await client.garmin.summaries.query({ sourceKeys: [source.sourceKey, "garmin:999:2026-09-28T07:00:00.000Z:0"] })).toEqual([corrected]);
  sqlite.prepare("INSERT INTO garmin_links VALUES (?, ?, ?, ?)").run(source.sourceKey, "2026-09-28", "activity", "run");
  expect(await client.garmin.list.query({ from: "2026-09-28", to: "2026-09-28" })).toEqual({ items: [], nextCursor: null });
  expect(await client.garmin.list.query({ from: "2026-09-28", to: "2026-09-28", includeLinked: true })).toMatchObject({ items: [{ status: "activity", targetId: "run" }], nextCursor: null });
  const later = Array.from({ length: 22 }, (_, i) => ({ ...source, sourceKey: `garmin:${200 + i}:2026-09-28T07:00:00.000Z:0`, title: `Run ${i}` }));
  expect(await importGarminSummaries(db, later)).toMatchObject({ inserted: 22 });
  for (let i = 0; i < later.length; i++) {
    sqlite.prepare("UPDATE garmin_activities SET imported_at = ? WHERE source_key = ?").run(`2026-09-29T${String(i === 1 ? 2 : i).padStart(2, "0")}:00:00.000Z`, later[i].sourceKey);
  }
  const firstPage = await client.garmin.list.query({ from: "2026-09-28", to: "2026-09-28" });
  expect(firstPage.items.map((item) => item.title)).toEqual(later.slice(2).reverse().map((item) => item.title));
  expect(firstPage.nextCursor).not.toBeNull();
  const secondPage = await client.garmin.list.query({ from: "2026-09-28", to: "2026-09-28", cursor: firstPage.nextCursor! });
  expect(secondPage.items.map((item) => item.title)).toEqual(["Run 1", "Run 0"]);
  expect(secondPage.nextCursor).toBeNull();
  expect((await client.backup.export.query()).garminActivities).toContainEqual(expect.objectContaining(corrected));
  sqlite.close();
});

it("auto-imports recent pending recordings on the Worker schedule, once each", async () => {
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
      const results = statements.map(({ sql, args }) => ({ meta: { changes: sqlite.prepare(sql).run(...args as []).changes } }));
      sqlite.exec("COMMIT");
      return results;
    } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } } as unknown as D1Database;
  const env = { APP_PASSWORD: "test-password", DB: db } as Env;
  let cookie = "";
  const client = createTRPCClient<AppRouter>({ links: [httpLink({ url: "https://example.test/api/trpc", fetch: async (input, init) => {
    const headers = new Headers(init?.headers);
    if (cookie) headers.set("Cookie", cookie);
    const response = await worker.fetch(new Request(input, { ...init, headers }) as Parameters<typeof worker.fetch>[0], env);
    cookie = response.headers.get("Set-Cookie")?.split(";")[0] ?? cookie;
    return response;
  } })] });
  const runSchedule = () => worker.scheduled({} as ScheduledController, env);
  await client.auth.login.mutate({ password: "test-password" });

  const date = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const old = new Date(Date.now() - 20 * 86_400_000).toISOString().slice(0, 10);
  const recording = (key: number, day: string, title: string, subSport: string | null): GarminActivitySummary => ({
    sourceKey: `garmin:${key}:${day}T06:00:00.000Z:0`, sport: title.toLowerCase(), subSport, title, startUtc: `${day}T06:00:00.000Z`,
    localDate: day, offsetMinutes: 600, timerSeconds: 3000, elapsedSeconds: 3600, activeCalories: 300,
  });
  const strength = recording(1, date, "Strength", "strengthTraining");
  const pickleball = recording(2, date, "Pickleball", null);
  const oldWalk = recording(3, old, "Walk", null);
  const day = emptyDay(date);
  addEventEntry(day, { kind: "session", session: { id: "left-running", startedAt: `${date}T15:45:00+10:00`, endedAt: null, warmup: [], main: [], cooldown: [], calories: null, notes: "" } });
  await client.days.save.mutate({ date, doc: day, base: null });
  await importGarminSummaries(db, [strength, pickleball, oldWalk]);

  await runSchedule();
  const imported = await client.days.get.query(date);
  expect(daySessions(imported.doc!)[0]).toMatchObject({ startedAt: `${date}T16:00:00+10:00`, endedAt: `${date}T17:00:00+10:00`, calories: 300 });
  const [activity] = dayActivities(imported.doc!);
  expect(activity.segments[0]).toMatchObject({ startedAt: `${date}T16:00:00+10:00`, result: { minutes: 50, calories: 300 } });
  expect(sqlite.prepare("SELECT name FROM exercise_catalog WHERE id = ?").get(activity.segments[0].exerciseId)).toEqual({ name: "Pickleball" });
  expect((await client.garmin.list.query({ from: old, to: date })).items.map((item) => item.title)).toEqual(["Walk"]);

  const unlinked = structuredClone(imported.doc!);
  unlinkGarmin(unlinked, pickleball.sourceKey);
  await client.days.save.mutate({ date, doc: unlinked, base: imported.updatedAt });
  await runSchedule();
  expect(dayActivities((await client.days.get.query(date)).doc!)).toHaveLength(1);
  expect((await client.garmin.list.query({ from: date, to: date })).items.map((item) => item.title)).toEqual(["Pickleball"]);
  sqlite.close();
});
