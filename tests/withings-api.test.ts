import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createTRPCClient, httpLink } from "@trpc/client";
import { afterEach, expect, it, vi } from "vitest";
import worker from "../backend/index";
import type { AppRouter } from "../backend/router";

const stores: DatabaseSync[] = [];
afterEach(() => { vi.unstubAllGlobals(); for (const db of stores.splice(0)) db.close(); });
function setup(configured = true) {
  const sqlite = new DatabaseSync(":memory:");
  stores.push(sqlite);
  for (const file of readdirSync("migrations").sort()) sqlite.exec(readFileSync(`migrations/${file}`, "utf8"));
  type Bound = { sql: string; args: unknown[] };
  const prepare = (sql: string, args: unknown[] = []) => ({ sql, args,
    bind(...values: unknown[]) { return prepare(sql, values); },
    async first() { return sqlite.prepare(sql).get(...args as []) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args as []) }; },
    async run() { return { meta: { changes: sqlite.prepare(sql).run(...args as []).changes } }; },
  });
  const db = { prepare, async batch(statements: Bound[]) {
    sqlite.exec("BEGIN");
    try {
      const results = statements.map(({ sql, args }) => ({ meta: { changes: sqlite.prepare(sql).run(...args as []).changes } }));
      sqlite.exec("COMMIT"); return results;
    } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } } as unknown as D1Database;
  const env = { DB: db, APP_PASSWORD: "trainoq-secret", ...(configured ? { WITHINGS_CLIENT_ID: "client", WITHINGS_CLIENT_SECRET: "client-secret" } : {}) } as Env;
  const cookies = new Map<string, string>();
  const saveCookies = (response: Response) => {
    for (const header of response.headers.getSetCookie()) { const [name, value] = header.split(";")[0].split("="); cookies.set(name, value); }
  };
  const cookie = () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  const client = createTRPCClient<AppRouter>({ links: [httpLink({ url: "https://trainoq.test/api/trpc", fetch: async (url, init) => {
    const headers = new Headers(init?.headers); headers.set("Cookie", cookie());
    const response = await worker.fetch(new Request(url, { ...init, headers }) as never, env); saveCookies(response); return response;
  } })] });
  const callback = async (state: string, extra = "code=auth-code", signedIn = true) => {
    const response = await worker.fetch(new Request(`https://trainoq.test/api/withings/callback?state=${state}&${extra}`, { headers: signedIn ? { Cookie: cookie() } : {} }) as never, env);
    saveCookies(response); return response;
  };
  return { sqlite, env, client, cookies, callback };
}
const json = (body: unknown) => new Response(JSON.stringify({ status: 0, body }));
const tokens = (access = "access", refresh = "refresh", expires = 10800, userid = 7) => json({ userid, access_token: access, refresh_token: refresh, expires_in: expires, scope: "user.metrics" });
const page = (groups = [12], more = 0, offset = 0, weight = 82500) => json({ timezone: "Australia/Sydney", updatetime: 1794950000, more, offset,
  measuregrps: groups.map((grpid) => ({ grpid, date: 1794949200 + (grpid - 12) * 3600, category: 1, measures: [{ type: 1, value: weight, unit: -3 }] })),
});
async function connect(s: ReturnType<typeof setup>) {
  await s.client.auth.login.mutate({ password: "trainoq-secret" });
  const { url } = await s.client.withings.authorize.mutate();
  const state = new URL(url).searchParams.get("state")!;
  const response = await s.callback(state);
  expect(response.status).toBe(303);
  expect(response.headers.get("Location")).toBe("/#/withings");
  return state;
}

it("answers unauthenticated Withings HEAD probes before setup without touching OAuth state or tokens", async () => {
  const s = setup(false);
  const prepare = vi.spyOn(s.env.DB, "prepare");
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  for (const query of ["", "?state=untrusted&code=probe"]) {
    const response = await worker.fetch(new Request(`https://trainoq.test/api/withings/callback${query}`, { method: "HEAD" }) as never, s.env);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(response.headers.get("Location")).toBeNull();
  }
  expect((await s.callback("untrusted", "code=probe", false)).status).toBe(401);
  for (const [method, path] of [["POST", "/api/withings/callback"], ["HEAD", "/api/withings/unknown"]]) {
    expect((await worker.fetch(new Request(`https://trainoq.test${path}`, { method }) as never, s.env)).status).toBe(404);
  }
  expect(prepare).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
});

it("requires auth, binds a one-use OAuth state to this browser, and keeps tokens out of status and backups", async () => {
  const s = setup();
  await expect(s.client.withings.authorize.mutate()).rejects.toMatchObject({ data: { code: "UNAUTHORIZED" } });
  await expect(s.client.withings.measurements.query({})).rejects.toMatchObject({ data: { code: "UNAUTHORIZED" } });
  await s.client.auth.login.mutate({ password: "trainoq-secret" });
  const { url } = await s.client.withings.authorize.mutate();
  const auth = new URL(url), state = auth.searchParams.get("state")!;
  expect(auth.origin).toBe("https://account.withings.com");
  expect(auth.searchParams.get("scope")).toBe("user.metrics");
  expect(auth.searchParams.get("redirect_uri")).toBe("https://trainoq.test/api/withings/callback");
  const fetcher = vi.fn().mockImplementation(async () => tokens()); vi.stubGlobal("fetch", fetcher);
  expect((await s.callback(state, "code=auth-code", false)).status).toBe(401);
  expect((await s.callback("wrong")).status).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
  expect((await s.callback(state)).headers.get("Location")).toBe("/#/withings");
  expect((await s.callback(state)).status).toBe(400);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(s.sqlite.prepare("SELECT * FROM withings_connection").get())).not.toMatch(/access|refresh/);
  const status = await s.client.withings.connection.query();
  expect(status).toMatchObject({ configured: true, connected: true, userId: "7", lastSyncAt: null });
  const backup = await s.client.backup.export.query();
  expect(backup.withingsMeasurements).toEqual([]);
  expect(JSON.stringify(backup)).not.toMatch(/access|refresh|client-secret/);
});

it("rejects expired state, cancellation and provider errors without replacing an existing connection", async () => {
  const s = setup(); vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => tokens()));
  await connect(s);
  const { url } = await s.client.withings.authorize.mutate(); const state = new URL(url).searchParams.get("state")!;
  s.sqlite.exec("UPDATE withings_oauth SET expires_at = 0");
  expect((await s.callback(state)).status).toBe(400);
  const denied = await s.client.withings.authorize.mutate();
  expect((await s.callback(new URL(denied.url).searchParams.get("state")!, "error=access_denied")).headers.get("Location")).toBe("/#/withings?error=authorization");
  expect(await s.client.withings.connection.query()).toMatchObject({ connected: true, userId: "7" });
});

it("imports resumable history, upserts corrections, preserves multiple readings and untouched DayDocs, and exports all readings", async () => {
  const s = setup();
  const fetcher = vi.fn().mockResolvedValueOnce(tokens()).mockResolvedValueOnce(page([12], 1, 100)).mockResolvedValueOnce(page([13])).mockResolvedValueOnce(page([12], 0, 0, 83000));
  vi.stubGlobal("fetch", fetcher); await connect(s);
  s.sqlite.prepare("INSERT INTO days VALUES (?, ?, ?)").run("2026-11-18", JSON.stringify({ v: 9, date: "2026-11-18", comments: [{ id: "note", time: "08:00", text: "Offline edits stay safe" }], events: [], garminLinks: [], totalCalories: null }), "original");
  expect(await s.client.withings.sync.mutate()).toMatchObject({ imported: 1, complete: false });
  expect(await s.client.withings.connection.query()).toMatchObject({ historyComplete: false });
  expect(await s.client.withings.sync.mutate()).toMatchObject({ imported: 1, complete: true });
  expect(await s.client.withings.sync.mutate()).toMatchObject({ imported: 1, complete: true });
  const requests = fetcher.mock.calls.slice(1).map(([, init]) => Object.fromEntries(new URLSearchParams(init.body)));
  expect(requests.map((r) => [r.lastupdate, r.offset])).toEqual([["0", "0"], ["0", "100"], ["1794949999", "0"]]);
  const first = await s.client.withings.measurements.query({ limit: 1 });
  expect(first.items).toHaveLength(1); expect(first.items[0].groupId).toBe("13"); expect(first.nextCursor).toBeTruthy();
  const second = await s.client.withings.measurements.query({ cursor: first.nextCursor!, limit: 1 });
  expect(second.items[0]).toMatchObject({ groupId: "12", weightKg: 83, localDate: "2026-11-18" }); expect(second.nextCursor).toBeNull();
  expect((await s.client.withings.measurements.query({ from: "2026-11-19", to: "2026-11-19" })).items).toEqual([]);
  expect((await s.client.withings.measurements.query({ from: "2026-11-18", to: "2026-11-18" })).items).toHaveLength(2);
  expect(s.sqlite.prepare("SELECT updated_at FROM days").get()).toEqual({ updated_at: "original" });
  expect((await s.client.backup.export.query()).withingsMeasurements).toHaveLength(2);
  await s.client.withings.disconnect.mutate();
  expect(await s.client.withings.connection.query()).toMatchObject({ connected: false });
  expect((await s.client.withings.measurements.query({})).items).toHaveLength(2);
});

it("rotates expired tokens before using them and prevents overlapping syncs and disconnects", async () => {
  const s = setup();
  const fetcher = vi.fn().mockResolvedValueOnce(tokens("old", "old-refresh", 1)).mockResolvedValueOnce(tokens("fresh", "next-refresh")).mockResolvedValueOnce(page());
  vi.stubGlobal("fetch", fetcher); await connect(s);
  expect(await s.client.withings.sync.mutate()).toMatchObject({ complete: true });
  expect(new URLSearchParams(fetcher.mock.calls[1][1].body).get("refresh_token")).toBe("old-refresh");
  expect(fetcher.mock.calls[2][1].headers.Authorization).toBe("Bearer fresh");
  s.sqlite.prepare("UPDATE withings_connection SET lock_until = ?").run(Date.now() + 60_000);
  await expect(s.client.withings.sync.mutate()).rejects.toThrow(/running/);
  await expect(s.client.withings.disconnect.mutate()).rejects.toThrow(/running/);
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it("retries rejected access tokens once and retains page cursors and safe errors after provider failure", async () => {
  const s = setup();
  const fetcher = vi.fn().mockResolvedValueOnce(tokens()).mockResolvedValueOnce(new Response(JSON.stringify({ status: 401 }))).mockResolvedValueOnce(tokens("fresh", "rotated")).mockResolvedValueOnce(page([12], 1, 100));
  vi.stubGlobal("fetch", fetcher); await connect(s); await s.client.withings.sync.mutate();
  fetcher.mockResolvedValueOnce(new Response("private token detail", { status: 503 }));
  await expect(s.client.withings.sync.mutate()).rejects.toThrow(/Withings/);
  expect(await s.client.withings.connection.query()).toMatchObject({ lastError: expect.stringMatching(/Retry/), connected: true });
  expect(s.sqlite.prepare("SELECT next_offset, last_update, lock_until FROM withings_connection").get()).toEqual({ next_offset: 100, last_update: 0, lock_until: null });
  fetcher.mockResolvedValueOnce(page([13])); await s.client.withings.sync.mutate();
  expect(new URLSearchParams(fetcher.mock.calls.at(-1)![1].body).get("offset")).toBe("100");
  expect(await s.client.withings.connection.query()).toMatchObject({ lastError: null });
});

it("rolls back readings and checkpoint together when a database write fails", async () => {
  const s = setup(); vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(tokens()).mockResolvedValueOnce(page([12, 13]))); await connect(s);
  s.sqlite.exec("CREATE TRIGGER fail_weight BEFORE INSERT ON withings_measurements WHEN NEW.group_id = '13' BEGIN SELECT RAISE(ABORT, 'test failure'); END");
  await expect(s.client.withings.sync.mutate()).rejects.toThrow();
  expect(s.sqlite.prepare("SELECT COUNT(*) AS n FROM withings_measurements").get()).toEqual({ n: 0 });
  expect(s.sqlite.prepare("SELECT last_update, next_offset, lock_until FROM withings_connection").get()).toEqual({ last_update: 0, next_offset: 0, lock_until: null });
});

it("polls Withings on the existing schedule even when Garmin fails, and does nothing when unconfigured", async () => {
  const s = setup(); vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(tokens()).mockResolvedValueOnce(page())); await connect(s);
  const prepare = s.env.DB.prepare.bind(s.env.DB);
  vi.spyOn(s.env.DB, "prepare").mockImplementation((sql) => {
    if (sql.includes("FROM garmin_connection")) throw new Error("Garmin unavailable");
    return prepare(sql);
  });
  await expect(worker.scheduled({} as never, s.env)).rejects.toThrow("Garmin unavailable");
  expect((await s.client.withings.measurements.query({})).items).toHaveLength(1);
  const unconfigured = setup(false);
  await unconfigured.client.auth.login.mutate({ password: "trainoq-secret" });
  expect(await unconfigured.client.withings.connection.query()).toMatchObject({ configured: false, connected: false });
  await expect(unconfigured.client.withings.authorize.mutate()).rejects.toThrow(/configured/);
});
