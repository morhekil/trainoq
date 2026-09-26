import { createTRPCClient, httpLink } from "@trpc/client";
import { describe, expect, it } from "vitest";
import { emptyDay } from "../shared/days/model";
import worker from "../backend/index";
import type { AppRouter } from "../backend/router";

describe("tRPC API", () => {
  it("authenticates and saves days with typed conflicts and validated input", async () => {
    let saved: { date: string; doc: string; updated_at: string } | null = null;
    const db = {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            return {
              sql,
              args,
              async first() {
                if (!saved || saved.date !== args[0]) return null;
                return sql.includes("SELECT updated_at") ? { updated_at: saved.updated_at } : saved;
              },
            };
          },
        };
      },
      async batch(stmts: { sql: string; args: unknown[] }[]) {
        for (const { sql, args } of stmts) {
          if (sql.startsWith("INSERT INTO days")) saved = { date: args[0] as string, doc: args[1] as string, updated_at: args[2] as string };
          if (sql.startsWith("DELETE FROM days")) saved = null;
        }
        return [];
      },
    } as unknown as D1Database;
    const env = { APP_PASSWORD: "test-password", DB: db } as Env;
    let cookie = "";
    const client = createTRPCClient<AppRouter>({ links: [httpLink({
      url: "https://example.test/api/trpc",
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers);
        if (cookie) headers.set("Cookie", cookie);
        const response = await worker.fetch(new Request(input, { ...init, headers }) as unknown as Parameters<typeof worker.fetch>[0], env);
        cookie = response.headers.get("Set-Cookie")?.split(";")[0] ?? cookie;
        return response;
      },
    })] });

    await expect(client.auth.me.query()).rejects.toMatchObject({ data: { code: "UNAUTHORIZED" } });
    await client.auth.login.mutate({ password: "test-password" });
    expect(await client.auth.me.query()).toEqual({ ok: true });

    const doc = { ...emptyDay("2026-09-23"), morning: "Ready" };
    const first = await client.days.save.mutate({ date: doc.date, doc, base: null });
    expect(first.ok).toBe(true);
    expect((await client.days.get.query(doc.date)).doc).toEqual(doc);
    const conflict = await client.days.save.mutate({ date: doc.date, doc, base: null });
    expect(conflict).toMatchObject({ ok: false, current: { doc } });

    const invalid = { ...doc, sessions: [{ id: "bad" }] };
    await expect(client.days.save.mutate({ date: doc.date, doc: invalid as typeof doc, base: null })).rejects.toMatchObject({ data: { code: "BAD_REQUEST" } });
  });
});
