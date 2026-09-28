import { DatabaseSync } from "node:sqlite";
import { createTRPCClient, httpLink } from "@trpc/client";
import { expect, it } from "vitest";
import worker from "../backend/index";
import type { AppRouter } from "../backend/router";
import type { GarminActivitySummary } from "../shared/garmin/fit";

it("imports bounded Garmin summaries through the authenticated Worker and keeps revisions separate", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE days (date TEXT PRIMARY KEY, doc TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE exercise_catalog (id TEXT PRIMARY KEY, name TEXT, name_key TEXT, section TEXT, aliases TEXT);
    CREATE TABLE garmin_activities (source_key TEXT PRIMARY KEY, summary TEXT NOT NULL, summary_hash TEXT NOT NULL, imported_at TEXT NOT NULL);
    CREATE TABLE garmin_links (source_key TEXT PRIMARY KEY, date TEXT NOT NULL, target_kind TEXT NOT NULL, target_id TEXT);`);
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
  await client.auth.login.mutate({ password: "test-password" });
  expect(await client.garmin.import.mutate({ activities: [source] })).toEqual({ inserted: 1, unchanged: 0, updated: 0, rejected: 0 });
  expect(await client.garmin.import.mutate({ activities: [source] })).toEqual({ inserted: 0, unchanged: 1, updated: 0, rejected: 0 });
  const corrected = { ...source, activeCalories: 173 };
  expect(await client.garmin.import.mutate({ activities: [corrected, { ...source, sourceKey: "bad" }] })).toEqual({ inserted: 0, unchanged: 0, updated: 1, rejected: 1 });
  expect(await client.garmin.list.query({ from: "2026-09-28", to: "2026-09-28" })).toMatchObject([{ ...corrected, status: "pending" }]);
  sqlite.prepare("INSERT INTO garmin_links VALUES (?, ?, ?, ?)").run(source.sourceKey, "2026-09-28", "activity", "run");
  expect(await client.garmin.list.query({ from: "2026-09-28", to: "2026-09-28" })).toMatchObject([{ status: "activity", targetId: "run" }]);
  expect((await client.backup.export.query()).garminActivities).toMatchObject([corrected]);
  await expect(client.garmin.import.mutate({ activities: Array.from({ length: 101 }, () => source) })).rejects.toMatchObject({ data: { code: "BAD_REQUEST" } });
  sqlite.close();
});
