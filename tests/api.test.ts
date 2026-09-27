import { createTRPCClient, httpLink } from "@trpc/client";
import { describe, expect, it, vi } from "vitest";
import { emptyDay } from "../shared/days/model";
import type { LegacyDayDoc } from "../shared/days/migrate";
import { exerciseIdForName } from "../shared/exercises/catalog";
import worker from "../backend/index";
import type { AppRouter } from "../backend/router";

describe("Worker tRPC boundary", () => {
  it("migrates old days, protects v3 writes, resolves catalog IDs and exports definitions", async () => {
    const days = new Map<string, { date: string; doc: string; updated_at: string }>();
    const catalog = new Map<string, string>();
    let logRows: { sql: string; args: unknown[] }[] = [];
    const db = {
      prepare(sql: string) {
        const statement = (args: unknown[]) => ({
          sql, args,
          bind(...next: unknown[]) { return statement(next); },
          async first() {
            if (sql.includes("FROM days")) {
              const row = days.get(args[0] as string);
              return sql.startsWith("SELECT updated_at") ? row && { updated_at: row.updated_at, doc: row.doc } : row ?? null;
            }
            if (sql.includes("FROM exercise_catalog")) return catalog.has(args[0] as string) ? { id: args[0], name: catalog.get(args[0] as string) } : null;
            return null;
          },
          async all() {
            if (sql.includes("FROM exercise_catalog")) {
              const rows = [...catalog].map(([id, name]) => ({ id, name }));
              return { results: sql.includes("WHERE id IN") ? rows.filter((row) => args.includes(row.id)) : rows };
            }
            return { results: [...days.values()] };
          },
          async run() {
            if (sql.startsWith("INSERT OR IGNORE INTO exercise_catalog")) catalog.set(args[0] as string, args[1] as string);
            return { success: true };
          },
        });
        return statement([]);
      },
      async batch(statements: { sql: string; args: unknown[] }[]) {
        if (statements[0].sql.startsWith("SELECT")) return [
          { results: [{ exercise_id: exerciseIdForName("Row"), name: "Row", section: "warmup", c: 1, last: "2026-09-23" }] },
          { results: [{ exercise_id: exerciseIdForName("Row"), name: "Row", date: "2026-09-23", section: "warmup", detail: JSON.stringify({ sets: [{ type: "working", weight: null, reps: 10 }] }) }] },
        ];
        logRows = statements.filter((statement) => statement.sql.startsWith("INSERT INTO exercise_log"));
        for (const { sql, args } of statements) {
          if (sql.startsWith("INSERT INTO days")) days.set(args[0] as string, { date: args[0] as string, doc: args[1] as string, updated_at: args[2] as string });
          if (sql.startsWith("DELETE FROM days")) days.delete(args[0] as string);
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
    try { await expect(client.auth.me.query()).rejects.toMatchObject({ data: { code: "UNAUTHORIZED" } }); expect(log).not.toHaveBeenCalled(); }
    finally { log.mockRestore(); }
    await client.auth.login.mutate({ password: "test-password" });

    const old: LegacyDayDoc = { ...emptyDay("2026-09-23"), v: 1, sessions: [{
      id: "s", startedAt: "2026-09-23T07:00:00Z", endedAt: null,
      warmup: [{ id: "w", name: "Row", reps: "2x10", comment: "Light band" }],
      main: [], cooldown: [], calories: null, notes: "",
    }] };
    const first = await client.days.save.mutate({ date: old.date, doc: old, base: null });
    expect(first.ok).toBe(true);
    const migrated = (await client.days.get.query(old.date)).doc!;
    expect(migrated.v).toBe(3);
    expect(migrated.sessions[0].warmup[0]).toMatchObject({ kind: "exercise", exerciseId: exerciseIdForName("Row"), comment: "Light band", sets: [{ reps: 10 }, { reps: 10 }] });
    expect((await client.days.list.query({ withSessions: true, limit: 10 }))[0].doc).toEqual(migrated);
    expect((await client.backup.export.query()).days[0].doc).toEqual(migrated);
    expect(logRows[0].args[6]).toBe(exerciseIdForName("Row"));
    expect((await client.exercises.library.query()).history[exerciseIdForName("Row")][0].sets[0].reps).toBe(10);
    await expect(client.days.save.mutate({ date: old.date, doc: old, base: first.ok ? first.updatedAt : null })).rejects.toMatchObject({ data: { code: "PRECONDITION_FAILED" } });

    const customId = "e164c8eb-a785-4c78-a854-f7a9f0787215";
    const custom = emptyDay("2026-09-24");
    custom.sessions = [{ id: "custom", startedAt: "2026-09-24T07:00:00Z", endedAt: null, warmup: [], main: [
      { kind: "superset", id: "ss", members: [{ id: "member", exerciseId: customId, comment: "" }], rounds: [{ id: "round", type: "working" }], results: [{ memberId: "member", roundId: "round", weight: 0, reps: 8 }] },
    ], cooldown: [], calories: null, notes: "" }];
    await expect(client.days.save.mutate({ date: custom.date, doc: custom, base: null })).rejects.toMatchObject({ data: { code: "BAD_REQUEST" } });
    await client.exercises.create.mutate({ id: customId, name: "Custom raise" });
    expect((await client.exercises.catalog.query()).some((entry) => entry.id === customId)).toBe(true);
    const saved = await client.days.save.mutate({ date: custom.date, doc: custom, base: null });
    expect(saved.ok).toBe(true);
    expect((await client.days.get.query(custom.date)).doc).toEqual(custom);
    expect(await client.days.save.mutate({ date: custom.date, doc: custom, base: null })).toMatchObject({ ok: false, current: { doc: custom } });
    expect((await client.backup.export.query()).catalog).toContainEqual({ id: customId, name: "Custom raise", section: null, aliases: "" });
    const invalid = structuredClone(custom);
    invalid.sessions[0].main[0] = { ...invalid.sessions[0].main[0], results: [] } as typeof invalid.sessions[0]["main"][number];
    await expect(client.days.save.mutate({ date: custom.date, doc: invalid, base: saved.ok ? saved.updatedAt : null })).rejects.toMatchObject({ data: { code: "BAD_REQUEST" } });
    const emptied = structuredClone(custom);
    emptied.sessions[0].main[0] = { ...emptied.sessions[0].main[0], members: [], results: [] } as typeof emptied.sessions[0]["main"][number];
    const emptySave = await client.days.save.mutate({ date: custom.date, doc: emptied, base: saved.ok ? saved.updatedAt : null });
    expect(emptySave.ok).toBe(true);
    expect((await client.days.get.query(custom.date)).doc?.sessions[0].main[0]).toMatchObject({ kind: "superset", rounds: [{ id: "round" }], members: [], results: [] });
  });
});
