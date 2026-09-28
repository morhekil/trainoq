import { createTRPCClient, httpLink } from "@trpc/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../backend/index";
import type { AppRouter } from "../backend/router";

function connectionDb() {
  let row: { encrypted_state: string; status: string; last_sync_at: string | null; last_error: string | null; next_offset: number } | null = null;
  return {
    get row() { return row; },
    prepare(sql: string) {
      let args: unknown[] = [];
      return {
        bind(...values: unknown[]) { args = values; return this; },
        async first() { return sql.includes("FROM garmin_connection") ? row : null; },
        async run() {
          if (sql.startsWith("INSERT INTO garmin_connection")) row = {
            encrypted_state: args[0] as string, status: args[1] as string, last_sync_at: null, last_error: null, next_offset: 0,
          };
          if (sql.startsWith("UPDATE garmin_connection") && row) {
            row.encrypted_state = args[0] as string;
            row.status = args[1] as string;
          }
          if (sql.startsWith("DELETE FROM garmin_connection")) row = null;
          return { success: true };
        },
      };
    },
  };
}

function clientFor(db: ReturnType<typeof connectionDb>) {
  const env = { APP_PASSWORD: "trainoq-secret", DB: db } as unknown as Env;
  let cookie = "";
  return createTRPCClient<AppRouter>({ links: [httpLink({ url: "https://example.test/api/trpc", fetch: async (input, init) => {
    const headers = new Headers(init?.headers);
    if (cookie) headers.set("Cookie", cookie);
    const response = await worker.fetch(new Request(input, { ...init, headers }) as never, env);
    cookie = response.headers.get("Set-Cookie")?.split(";")[0] ?? cookie;
    return response;
  } })] });
}

const json = (value: unknown, headers?: HeadersInit) => new Response(JSON.stringify(value), { status: 200, headers });

describe("Garmin connection tRPC boundary", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("requires Trainoq auth, stores only ciphertext and returns a safe connection status", async () => {
    const db = connectionDb();
    const client = clientFor(db);
    await expect(client.garmin.connect.mutate({ email: "me@example.com", password: "garmin-password" }))
      .rejects.toMatchObject({ data: { code: "UNAUTHORIZED" } });
    await client.auth.login.mutate({ password: "trainoq-secret" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({ responseStatus: { type: "SUCCESSFUL" }, serviceTicketId: "ST-1" }))
      .mockResolvedValueOnce(json({ access_token: "access", refresh_token: "refresh" })));

    expect(await client.garmin.connect.mutate({ email: "me@example.com", password: "garmin-password" }))
      .toEqual({ status: "connected" });
    expect(db.row?.encrypted_state).not.toContain("garmin-password");
    expect(db.row?.encrypted_state).not.toContain("refresh");
    expect(await client.garmin.connection.query()).toMatchObject({ status: "connected", email: "me@example.com" });
    await client.garmin.disconnect.mutate();
    expect(await client.garmin.connection.query()).toEqual({ status: "disconnected", email: null, lastSyncAt: null, lastError: null, nextOffset: 0 });
  });

  it("accepts the MFA code in a second authenticated request", async () => {
    const db = connectionDb();
    const client = clientFor(db);
    await client.auth.login.mutate({ password: "trainoq-secret" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({ responseStatus: { type: "MFA_REQUIRED" }, customerMfaInfo: { mfaLastMethodUsed: "email" } }, { "Set-Cookie": "SSO=abc; Path=/" }))
      .mockResolvedValueOnce(json({ responseStatus: { type: "SUCCESSFUL" }, serviceTicketId: "ST-2" }))
      .mockResolvedValueOnce(json({ access_token: "access", refresh_token: "refresh" })));

    expect(await client.garmin.connect.mutate({ email: "me@example.com", password: "garmin-password" })).toEqual({ status: "mfa" });
    expect(await client.garmin.connection.query()).toMatchObject({ status: "mfa" });
    db.row!.next_offset = 20;
    expect(await client.garmin.verifyMfa.mutate({ code: "123456" })).toEqual({ status: "connected" });
    expect(await client.garmin.connection.query()).toMatchObject({ status: "connected", nextOffset: 20 });
  });
});
