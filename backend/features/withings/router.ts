import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { dateSchema } from "../../../shared/days/schema";
import { t } from "../../trpc";
import { authed } from "../auth/router";
import { listWeights, readConnection } from "./db";
import { authorizeWithings } from "./oauth";
import { syncWithings } from "./sync";

export const withingsRouter = t.router({
  connection: authed.query(async ({ ctx }) => {
    const row = await readConnection(ctx.env.DB);
    return { configured: Boolean(ctx.env.WITHINGS_CLIENT_ID && ctx.env.WITHINGS_CLIENT_SECRET), connected: Boolean(row), userId: row?.user_id ?? null,
      lastSyncAt: row?.last_sync_at ?? null, lastError: row?.last_error ?? null, historyComplete: (row?.last_update ?? 0) > 0 };
  }),
  authorize: authed.mutation(({ ctx }) => authorizeWithings(ctx.req, ctx.resHeaders, ctx.env)),
  sync: authed.mutation(({ ctx }) => syncWithings(ctx.env)),
  disconnect: authed.mutation(async ({ ctx }) => {
    const result = await ctx.env.DB.prepare("DELETE FROM withings_connection WHERE id = 1 AND (lock_until IS NULL OR lock_until < ?)").bind(Date.now()).run();
    if (!result.meta.changes && await readConnection(ctx.env.DB)) throw new TRPCError({ code: "CONFLICT", message: "A Withings sync is running. Retry disconnect shortly." });
    await ctx.env.DB.prepare("DELETE FROM withings_oauth").run();
    return { ok: true };
  }),
  measurements: authed.input(z.object({ from: dateSchema.optional(), to: dateSchema.optional(), limit: z.number().int().min(1).max(200).default(50),
    cursor: z.object({ measuredAt: z.iso.datetime(), sourceId: z.string().min(1) }).optional(),
  }).refine(({ from, to }) => !from || !to || from <= to, "Choose a date range in order"))
    .query(({ ctx, input }) => listWeights(ctx.env.DB, input)),
});
