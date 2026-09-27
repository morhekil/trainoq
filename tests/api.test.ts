import { createTRPCClient, httpLink } from "@trpc/client";
import { describe, expect, it, vi } from "vitest";
import { emptyDay } from "../shared/days/model";
import type { LegacyDayDoc } from "../shared/days/migrate";
import worker from "../backend/index";
import type { AppRouter } from "../backend/router";

describe("tRPC API", () => {
  it("authenticates and saves days with typed conflicts and validated input", async () => {
    let saved: { date: string; doc: string; updated_at: string } | null = null;
    let statements: { sql: string; args: unknown[] }[] = [];
    const db = {
      prepare(sql: string) {
        return {
          sql,
          async all() { return { results: saved ? [saved] : [] }; },
          bind(...args: unknown[]) {
            return {
              sql,
              args,
              async all() { return { results: saved ? [saved] : [] }; },
              async first() {
                if (!saved || saved.date !== args[0]) return null;
                return sql.includes("SELECT updated_at") ? { updated_at: saved.updated_at } : saved;
              },
            };
          },
        };
      },
      async batch(stmts: { sql: string; args: unknown[] }[]) {
        if (stmts[0].sql.startsWith("SELECT")) return [
          { results: [{ name_key: "row", name: "Row", section: "warmup", c: 1, last: doc.date }] },
          { results: [{ name_key: "row", date: doc.date, section: "warmup", detail: JSON.stringify({ reps: "2x10" }) }] },
        ];
        statements = stmts;
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

    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(client.auth.me.query()).rejects.toMatchObject({ data: { code: "UNAUTHORIZED" } });
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
    await client.auth.login.mutate({ password: "test-password" });
    expect(await client.auth.me.query()).toEqual({ ok: true });

    const doc = { ...emptyDay("2026-09-23"), morning: "Ready" };
    const first = await client.days.save.mutate({ date: doc.date, doc, base: null });
    expect(first.ok).toBe(true);
    expect((await client.days.get.query(doc.date)).doc).toEqual(doc);
    const conflict = await client.days.save.mutate({ date: doc.date, doc, base: null });
    expect(conflict).toMatchObject({ ok: false, current: { doc } });

    const legacy: LegacyDayDoc = {
      ...doc, v: 1,
      sessions: [{
        id: "s", startedAt: "2026-09-23T07:00:00Z", endedAt: null,
        warmup: [{ id: "w", name: "Row", reps: "2x10", comment: "Light band" }],
        main: [], cooldown: [{ id: "c", name: "Stretch", reps: "30s", comment: "" }],
        calories: null, notes: "",
      }],
    };
    const migrated = await client.days.save.mutate({ date: doc.date, doc: legacy, base: first.ok ? first.updatedAt : null });
    expect(migrated.ok).toBe(true);
    const stored = (await client.days.get.query(doc.date)).doc!;
    expect(stored.v).toBe(2);
    expect(stored.sessions[0].warmup[0].exercises[0].sets.map((s) => s.reps)).toEqual([10, 10]);
    expect((await client.days.list.query({ withSessions: true, limit: 10 }))[0].doc).toEqual(stored);
    expect((await client.backup.export.query()).days[0].doc).toEqual(stored);
    expect(statements.filter((s) => s.sql.startsWith("INSERT INTO exercise_log")).map((s) => JSON.parse(s.args[4] as string).sets.length)).toEqual([2, 1]);
    expect((await client.exercises.library.query()).history.row[0]).toEqual({
      date: doc.date, section: "warmup", sets: [
        { type: "working", weight: null, reps: 10 },
        { type: "working", weight: null, reps: 10 },
      ],
    });

    saved!.doc = JSON.stringify(legacy);
    expect((await client.days.get.query(doc.date)).doc).toEqual(stored);
    expect((await client.days.list.query({ limit: 10 }))[0].doc).toEqual(stored);
    expect((await client.backup.export.query()).days[0].doc).toEqual(stored);
    expect(await client.days.save.mutate({ date: doc.date, doc, base: null })).toMatchObject({ ok: false, current: { doc: stored } });
    const unknown = structuredClone(legacy);
    unknown.sessions[0].warmup[0].reps = "about ten";
    await expect(client.days.save.mutate({ date: doc.date, doc: unknown, base: saved!.updated_at })).rejects.toMatchObject({ data: { code: "BAD_REQUEST" } });

    const invalid = { ...doc, sessions: [{ id: "bad" }] };
    await expect(client.days.save.mutate({ date: doc.date, doc: invalid as typeof doc, base: null })).rejects.toMatchObject({ data: { code: "BAD_REQUEST" } });
  });
});
