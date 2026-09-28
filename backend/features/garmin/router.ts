import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { t } from "../../trpc";
import { authed } from "../auth/router";
import { dateSchema } from "../../../shared/days/schema";
import type { GarminActivitySummary } from "../../../shared/garmin/fit";
import { loginGarmin, verifyGarminMfa } from "./connect";
import { readGarminConnection, saveGarminConnection } from "./connection";

const summarySchema = z.object({
  sourceKey: z.string().regex(/^garmin:\d+:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z:\d+$/),
  sport: z.string().min(1).max(80),
  subSport: z.string().max(80).nullable(),
  title: z.string().min(1).max(200),
  startUtc: z.iso.datetime(),
  localDate: dateSchema.nullable(),
  offsetMinutes: z.number().int().min(-720).max(840).nullable(),
  timerSeconds: z.number().finite().min(0).max(604800).nullable(),
  elapsedSeconds: z.number().finite().min(0).max(604800).nullable(),
  activeCalories: z.number().finite().min(0).max(100000),
}) satisfies z.ZodType<GarminActivitySummary>;

const importSchema = z.object({ activities: z.array(z.unknown()).max(100) })
  .refine((input) => JSON.stringify(input).length <= 256 * 1024, "Import batch is too large");

interface GarminRow { summary: string; imported_at: string; target_kind: string | null; target_id: string | null; decision_date: string | null }

export async function listGarmin(db: D1Database, from: string, to: string) {
  const { results } = await db.prepare(`SELECT g.summary, g.imported_at, l.target_kind, l.target_id, l.date AS decision_date
    FROM garmin_activities g LEFT JOIN garmin_links l ON l.source_key = g.source_key
    WHERE COALESCE(json_extract(g.summary, '$.localDate'), substr(json_extract(g.summary, '$.startUtc'), 1, 10)) BETWEEN ? AND ?
    ORDER BY json_extract(g.summary, '$.startUtc'), g.source_key`).bind(from, to).all<GarminRow>();
  return results.map((row) => ({ ...summarySchema.parse(JSON.parse(row.summary)), importedAt: row.imported_at,
    status: row.target_kind ?? "pending", targetId: row.target_id, decisionDate: row.decision_date }));
}

export async function allGarmin(db: D1Database): Promise<GarminActivitySummary[]> {
  const { results } = await db.prepare("SELECT summary FROM garmin_activities ORDER BY source_key").all<{ summary: string }>();
  return results.map((row) => summarySchema.parse(JSON.parse(row.summary)));
}

async function hash(summary: string): Promise<string> {
  const bytes = new TextEncoder().encode(summary);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (n) => n.toString(16).padStart(2, "0")).join("");
}

export const garminRouter = t.router({
  connection: authed.query(async ({ ctx }) => {
    const connected = await readGarminConnection(ctx.env.DB, ctx.env.APP_PASSWORD);
    return connected ? { status: connected.row.status, email: connected.state.email,
      lastSyncAt: connected.row.last_sync_at, lastError: connected.row.last_error, nextOffset: connected.row.next_offset }
      : { status: "disconnected", email: null, lastSyncAt: null, lastError: null, nextOffset: 0 };
  }),
  connect: authed.input(z.object({ email: z.email().max(254), password: z.string().min(1).max(1024) })).mutation(async ({ ctx, input }) => {
    const result = await loginGarmin(input.email, input.password);
    if (result.kind === "mfa") {
      await saveGarminConnection(ctx.env.DB, ctx.env.APP_PASSWORD, {
        email: input.email, password: input.password, pending: result.pending,
      }, "mfa");
      return { status: "mfa" as const };
    }
    await saveGarminConnection(ctx.env.DB, ctx.env.APP_PASSWORD, {
      email: input.email, password: input.password, tokens: result.tokens,
    }, "connected");
    return { status: "connected" as const };
  }),
  verifyMfa: authed.input(z.object({ code: z.string().min(1).max(20) })).mutation(async ({ ctx, input }) => {
    const connected = await readGarminConnection(ctx.env.DB, ctx.env.APP_PASSWORD);
    if (!connected?.state.pending) throw new TRPCError({ code: "BAD_REQUEST", message: "No Garmin verification is pending." });
    const tokens = await verifyGarminMfa(connected.state.pending, input.code);
    await saveGarminConnection(ctx.env.DB, ctx.env.APP_PASSWORD, {
      email: connected.state.email, password: connected.state.password, tokens,
    }, "connected");
    return { status: "connected" as const };
  }),
  disconnect: authed.mutation(async ({ ctx }) => {
    await ctx.env.DB.prepare("DELETE FROM garmin_connection WHERE id = 1").run();
    return { status: "disconnected" as const };
  }),
  import: authed.input(importSchema).mutation(async ({ ctx, input }) => {
    const counts = { inserted: 0, unchanged: 0, updated: 0, rejected: 0 };
    for (const candidate of input.activities) {
      const parsed = summarySchema.safeParse(candidate);
      if (!parsed.success) { counts.rejected++; continue; }
      const summary = JSON.stringify(parsed.data);
      const summaryHash = await hash(summary);
      const existing = await ctx.env.DB.prepare("SELECT summary_hash FROM garmin_activities WHERE source_key = ?").bind(parsed.data.sourceKey).first<{ summary_hash: string }>();
      if (existing?.summary_hash === summaryHash) { counts.unchanged++; continue; }
      await ctx.env.DB.prepare(`INSERT INTO garmin_activities (source_key, summary, summary_hash, imported_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(source_key) DO UPDATE SET summary = excluded.summary, summary_hash = excluded.summary_hash, imported_at = excluded.imported_at`)
        .bind(parsed.data.sourceKey, summary, summaryHash, new Date().toISOString()).run();
      if (existing) counts.updated++; else counts.inserted++;
    }
    return counts;
  }),
  list: authed.input(z.object({ from: dateSchema, to: dateSchema }).refine(({ from, to }) => from <= to, "Invalid date range"))
    .query(({ ctx, input }) => listGarmin(ctx.env.DB, input.from, input.to)),
});
