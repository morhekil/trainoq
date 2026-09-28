import { DatabaseSync } from "node:sqlite";
import { createTRPCClient, httpLink } from "@trpc/client";
import { zipSync } from "fflate";
import { expect, it, vi } from "vitest";
import { readGarminConnection, saveGarminConnection } from "../backend/features/garmin/connection";
import { syncGarminPage } from "../backend/features/garmin/sync";
import worker from "../backend/index";
import type { AppRouter } from "../backend/router";

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

it("refreshes an expired Garmin token and persists the replacement", async () => {
  const { sqlite, db } = database();
  await saveGarminConnection(db, "app-secret", { email: "me@example.com", password: "password", tokens: {
    accessToken: "old", refreshToken: "refresh", clientId: "client",
  } }, "connected");
  const archive = zipSync({ "activity.fit": fit });
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/activities/search/activities") && (init?.headers as Record<string, string>).Authorization === "Bearer old")
      return new Response("", { status: 401 });
    if (url.includes("/di-oauth2-service/oauth/token")) return new Response(JSON.stringify({ access_token: "fresh", refresh_token: "next" }));
    if (url.includes("/activities/search/activities")) return new Response(JSON.stringify([{ activityId: 123 }]));
    if (url.endsWith("/activity/123")) return new Response(archive as BodyInit);
    throw new Error(`Unexpected Garmin URL ${url}`);
  });

  expect(await syncGarminPage(db, "app-secret", fetcher)).toMatchObject({ inserted: 1, complete: true });
  expect((await readGarminConnection(db, "app-secret"))?.state.tokens).toMatchObject({ accessToken: "fresh", refreshToken: "next" });
  sqlite.close();
});

it("continues after an unusable FIT and retries that Garmin ID on the next scan", async () => {
  const { sqlite, db } = database();
  await saveGarminConnection(db, "app-secret", { email: "me@example.com", password: "password", tokens: {
    accessToken: "access", refreshToken: "refresh", clientId: "client",
  } }, "connected");
  let firstExportIsBad = true;
  const archive = zipSync({ "activity.fit": fit });
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/activities/search/activities")) return new Response(JSON.stringify([{ activityId: 122 }, { activityId: 123 }]));
    if (url.endsWith("/activity/122")) return new Response((firstExportIsBad ? zipSync({ "bad.fit": Uint8Array.from([1]) }) : archive) as BodyInit);
    if (url.endsWith("/activity/123")) return new Response(archive as BodyInit);
    throw new Error(`Unexpected Garmin URL ${url}`);
  });

  expect(await syncGarminPage(db, "app-secret", fetcher)).toMatchObject({ scanned: 2, inserted: 1, rejected: 1, complete: true });
  expect(sqlite.prepare("SELECT activity_id FROM garmin_downloads ORDER BY activity_id").all()).toMatchObject([{ activity_id: "123" }]);
  firstExportIsBad = false;
  expect(await syncGarminPage(db, "app-secret", fetcher)).toMatchObject({ scanned: 2, unchanged: 2, rejected: 0 });
  expect(sqlite.prepare("SELECT activity_id FROM garmin_downloads ORDER BY activity_id").all()).toMatchObject([{ activity_id: "122" }, { activity_id: "123" }]);
  sqlite.close();
});

it("syncs through the authenticated Worker API and its scheduled handler", async () => {
  const { sqlite, db } = database();
  await saveGarminConnection(db, "app-secret", { email: "me@example.com", password: "password", tokens: {
    accessToken: "access", refreshToken: "refresh", clientId: "client",
  } }, "connected");
  const env = { APP_PASSWORD: "app-secret", DB: db } as Env;
  let cookie = "";
  const client = createTRPCClient<AppRouter>({ links: [httpLink({ url: "https://example.test/api/trpc", fetch: async (input, init) => {
    const headers = new Headers(init?.headers);
    if (cookie) headers.set("Cookie", cookie);
    const response = await worker.fetch(new Request(input, { ...init, headers }) as never, env);
    cookie = response.headers.get("Set-Cookie")?.split(";")[0] ?? cookie;
    return response;
  } })] });
  const archive = zipSync({ "activity.fit": fit });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/activities/search/activities")) return new Response(JSON.stringify([{ activityId: 123 }]));
    if (url.endsWith("/activity/123")) return new Response(archive as BodyInit);
    throw new Error(`Unexpected Garmin URL ${url}`);
  }));
  await expect(client.garmin.sync.mutate()).rejects.toMatchObject({ data: { code: "UNAUTHORIZED" } });
  await client.auth.login.mutate({ password: "app-secret" });
  expect(await client.garmin.sync.mutate()).toMatchObject({ scanned: 1, inserted: 1, complete: true });
  await worker.scheduled({ cron: "*/5 * * * *" } as ScheduledEvent, env);
  expect(sqlite.prepare("SELECT COUNT(*) AS count FROM garmin_downloads").get()).toMatchObject({ count: 1 });
  vi.unstubAllGlobals();
  sqlite.close();
});

it("signs in again with the stored password when Garmin rejects the refresh token", async () => {
  const { sqlite, db } = database();
  await saveGarminConnection(db, "app-secret", { email: "me@example.com", password: "stored-password", tokens: {
    accessToken: "old", refreshToken: "expired", clientId: "client",
  } }, "connected");
  const archive = zipSync({ "activity.fit": fit });
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/activities/search/activities") && (init?.headers as Record<string, string>).Authorization === "Bearer old") return new Response("", { status: 401 });
    if (url.includes("/di-oauth2-service/oauth/token") && String(init?.body).includes("refresh_token=expired")) return new Response("", { status: 400 });
    if (url.includes("/mobile/api/login")) {
      expect(String(init?.body)).toContain("stored-password");
      return new Response(JSON.stringify({ responseStatus: { type: "SUCCESSFUL" }, serviceTicketId: "ST-new" }));
    }
    if (url.includes("/di-oauth2-service/oauth/token")) return new Response(JSON.stringify({ access_token: "new", refresh_token: "new-refresh" }));
    if (url.includes("/activities/search/activities")) return new Response(JSON.stringify([{ activityId: 123 }]));
    if (url.endsWith("/activity/123")) return new Response(archive as BodyInit);
    throw new Error(`Unexpected Garmin URL ${url}`);
  });
  expect(await syncGarminPage(db, "app-secret", fetcher)).toMatchObject({ inserted: 1, complete: true });
  expect((await readGarminConnection(db, "app-secret"))?.state.tokens).toMatchObject({ accessToken: "new", refreshToken: "new-refresh" });
  sqlite.close();
});

it("asks for verification if a reconnect triggers Garmin's MFA challenge", async () => {
  const { sqlite, db } = database();
  await saveGarminConnection(db, "app-secret", { email: "me@example.com", password: "stored-password", tokens: {
    accessToken: "old", refreshToken: "expired", clientId: "client",
  } }, "connected");
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/activities/search/activities")) return new Response("", { status: 401 });
    if (url.includes("/di-oauth2-service/oauth/token")) return new Response("", { status: 400 });
    if (url.includes("/mobile/api/login")) return new Response(JSON.stringify({ responseStatus: { type: "MFA_REQUIRED" } }), { headers: { "Set-Cookie": "SSO=abc; Path=/" } });
    throw new Error(`Unexpected Garmin URL ${url} ${init?.method}`);
  });
  await expect(syncGarminPage(db, "app-secret", fetcher)).rejects.toThrow("verification code");
  const connection = await readGarminConnection(db, "app-secret");
  expect(connection?.row.status).toBe("mfa");
  expect(connection?.state.pending?.cookie).toBe("SSO=abc");
  expect(connection?.row.next_offset).toBe(0);
  sqlite.close();
});

it("stops scheduled retries after Garmin rejects the stored password", async () => {
  const { sqlite, db } = database();
  await saveGarminConnection(db, "app-secret", { email: "me@example.com", password: "old-password", tokens: {
    accessToken: "old", refreshToken: "expired", clientId: "client",
  } }, "connected");
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/activities/search/activities")) return new Response("", { status: 401 });
    if (url.includes("/di-oauth2-service/oauth/token")) return new Response("", { status: 400 });
    if (url.includes("/mobile/api/login")) return new Response(JSON.stringify({ responseStatus: { type: "INVALID_USERNAME_PASSWORD" } }));
    throw new Error(`Unexpected Garmin URL ${url}`);
  });
  await expect(syncGarminPage(db, "app-secret", fetcher)).rejects.toThrow("email or password");
  expect((await readGarminConnection(db, "app-secret"))?.row).toMatchObject({ status: "error", last_error: "Garmin rejected the email or password." });
  sqlite.close();
});

it("keeps a rate-limited connection eligible for the next scheduled retry", async () => {
  const { sqlite, db } = database();
  await saveGarminConnection(db, "app-secret", { email: "me@example.com", password: "password", tokens: {
    accessToken: "access", refreshToken: "refresh", clientId: "client",
  } }, "connected");
  const fetcher = vi.fn(async () => new Response("", { status: 429 }));
  await expect(syncGarminPage(db, "app-secret", fetcher)).rejects.toThrow("rate limited");
  expect((await readGarminConnection(db, "app-secret"))?.row).toMatchObject({ status: "connected", last_error: "Garmin rate limited activity sync. Try again later." });
  sqlite.close();
});

it("allows reconnecting when the Trainoq encryption secret changes", async () => {
  const { sqlite, db } = database();
  await saveGarminConnection(db, "old-secret", { email: "me@example.com", password: "password", tokens: {
    accessToken: "access", refreshToken: "refresh", clientId: "client",
  } }, "connected");
  expect(await readGarminConnection(db, "new-secret")).toBeNull();
  await saveGarminConnection(db, "new-secret", { email: "me@example.com", password: "new-password", tokens: {
    accessToken: "new", refreshToken: "next", clientId: "client",
  } }, "connected");
  expect((await readGarminConnection(db, "new-secret"))?.state.password).toBe("new-password");
  sqlite.close();
});

it("continues past an activity whose original export is unavailable", async () => {
  const { sqlite, db } = database();
  await saveGarminConnection(db, "app-secret", { email: "me@example.com", password: "password", tokens: {
    accessToken: "access", refreshToken: "refresh", clientId: "client",
  } }, "connected");
  const archive = zipSync({ "activity.fit": fit });
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/activities/search/activities")) return new Response(JSON.stringify([{ activityId: 122 }, { activityId: 123 }]));
    if (url.endsWith("/activity/122")) return new Response("", { status: 404 });
    if (url.endsWith("/activity/123")) return new Response(archive as BodyInit);
    throw new Error(`Unexpected Garmin URL ${url}`);
  });
  expect(await syncGarminPage(db, "app-secret", fetcher)).toMatchObject({ scanned: 2, inserted: 1, rejected: 1, complete: true });
  expect(sqlite.prepare("SELECT activity_id FROM garmin_downloads").all()).toMatchObject([{ activity_id: "123" }]);
  sqlite.close();
});
