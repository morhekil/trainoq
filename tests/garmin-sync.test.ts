import { DatabaseSync } from "node:sqlite";
import { zipSync } from "fflate";
import { expect, it, vi } from "vitest";
import { saveGarminConnection } from "../backend/features/garmin/connection";
import { syncGarminPage } from "../backend/features/garmin/sync";

const fit = Uint8Array.from(Buffer.from("DgLhUpUAAAAuRklURV5AAAAAAAUAAQIBAoQCAoQDBIwEBIYABAEAAQB7AAAAPXUcRUEAABIADP4ChAIEhv0EhgUBAgYBAm4EBwcEhggEhgsChMQChAABAgEBAgEAAD11HEVWexxFAQBSdW4A+9IXAPvSFwDPACMACAFCAAAiAAb9BIYFBIYBAoQABIYDAQIEAQICPXUcRd0BHUUBAPvSFwAaAVfl", "base64"));

function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE garmin_connection (id INTEGER PRIMARY KEY, encrypted_state TEXT, status TEXT, next_offset INTEGER, last_sync_at TEXT, last_error TEXT, updated_at TEXT, sync_lock_until TEXT);
    CREATE TABLE garmin_downloads (activity_id TEXT PRIMARY KEY, imported_at TEXT NOT NULL);
    CREATE TABLE garmin_activities (source_key TEXT PRIMARY KEY, summary TEXT NOT NULL, summary_hash TEXT NOT NULL, imported_at TEXT NOT NULL);`);
  const prepare = (sql: string, args: unknown[] = []) => ({
    bind(...values: unknown[]) { return prepare(sql, values); },
    async first() { return sqlite.prepare(sql).get(...args as []) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args as []) }; },
    async run() { return { meta: { changes: sqlite.prepare(sql).run(...args as []).changes } }; },
  });
  return { sqlite, db: { prepare } as unknown as D1Database };
}

it("backfills original FITs once, then skips recorded Garmin IDs", async () => {
  const { sqlite, db } = database();
  await saveGarminConnection(db, "app-secret", { email: "me@example.com", password: "password", tokens: {
    accessToken: "access", refreshToken: "refresh", clientId: "client",
  } }, "connected");
  const archive = zipSync({ "activity.fit": fit });
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/activities/search/activities")) return new Response(JSON.stringify([{ activityId: 123 }]));
    if (url.endsWith("/activity/123")) return new Response(archive as BodyInit);
    throw new Error(`Unexpected Garmin URL ${url}`);
  });

  expect(await syncGarminPage(db, "app-secret", fetcher)).toEqual({
    scanned: 1, inserted: 1, unchanged: 0, updated: 0, rejected: 0, nextOffset: 0, complete: true,
  });
  expect(JSON.parse(sqlite.prepare("SELECT summary FROM garmin_activities").get()!.summary as string).activeCalories).toBe(172);
  expect(sqlite.prepare("SELECT activity_id FROM garmin_downloads").get()).toMatchObject({ activity_id: "123" });
  expect(await syncGarminPage(db, "app-secret", fetcher)).toMatchObject({ scanned: 1, inserted: 0, unchanged: 1, complete: true });
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/activity/123"))).toHaveLength(1);
  sqlite.close();
});
