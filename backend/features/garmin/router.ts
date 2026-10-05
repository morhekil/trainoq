import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { t } from "../../trpc";
import { authed } from "../auth/router";
import { dateSchema } from "../../../shared/days/schema";
import { loginGarmin, verifyGarminMfa } from "./connect";
import { readGarminConnection, saveGarminConnection, updateGarminConnection } from "./connection";
import { importGarminSummaries, listGarmin } from "./db";
import { syncGarminPage } from "./sync";

const importSchema = z.object({ activities: z.array(z.unknown()).max(100) })
  .refine((input) => JSON.stringify(input).length <= 256 * 1024, "Import batch is too large");

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
    await updateGarminConnection(ctx.env.DB, ctx.env.APP_PASSWORD, {
      email: connected.state.email, password: connected.state.password, tokens,
    }, "connected");
    return { status: "connected" as const };
  }),
  disconnect: authed.mutation(async ({ ctx }) => {
    await ctx.env.DB.prepare("DELETE FROM garmin_connection WHERE id = 1").run();
    return { status: "disconnected" as const };
  }),
  sync: authed.mutation(({ ctx }) => syncGarminPage(ctx.env.DB, ctx.env.APP_PASSWORD)),
  import: authed.input(importSchema).mutation(({ ctx, input }) => importGarminSummaries(ctx.env.DB, input.activities)),
  list: authed.input(z.object({ from: dateSchema, to: dateSchema, includeLinked: z.boolean().optional(),
    cursor: z.object({ importedAt: z.iso.datetime(), sourceKey: z.string().min(1) }).optional(),
  }).refine(({ from, to }) => from <= to, "Invalid date range"))
    .query(({ ctx, input }) => listGarmin(ctx.env.DB, input.from, input.to, input.includeLinked, input.cursor)),
});
