import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import { dateSchema, daySchema } from "../shared/schema";
import { clearSessionCookie, isAuthed, sessionCookie } from "./auth";
import { exerciseLibrary, exportAll, getDay, listDays, putDay } from "./db";

export interface Context {
  req: Request;
  resHeaders: Headers;
  env: Env;
}

const t = initTRPC.context<Context>().create();
const authed = t.procedure.use(async ({ ctx, next }) => {
  if (!(await isAuthed(ctx.req, ctx.env))) throw new TRPCError({ code: "UNAUTHORIZED", message: "Not signed in" });
  return next();
});

export const appRouter = t.router({
  auth: t.router({
    me: authed.query(() => ({ ok: true })),
    login: t.procedure.input(z.object({ password: z.string() })).mutation(async ({ ctx, input }) => {
      const cookie = await sessionCookie(input.password, ctx.req, ctx.env);
      if (!cookie) throw new TRPCError({ code: "UNAUTHORIZED", message: "Wrong password" });
      ctx.resHeaders.set("Set-Cookie", cookie);
      return { ok: true };
    }),
    logout: t.procedure.mutation(({ ctx }) => {
      ctx.resHeaders.set("Set-Cookie", clearSessionCookie(ctx.req));
      return { ok: true };
    }),
  }),
  days: t.router({
    get: authed.input(dateSchema).query(async ({ ctx, input: date }) =>
      (await getDay(ctx.env.DB, date)) ?? { date, doc: null, updatedAt: null },
    ),
    list: authed.input(z.object({
      before: dateSchema.optional(),
      limit: z.number().int().min(1).max(200).default(30),
      withSessions: z.boolean().default(false),
    })).query(({ ctx, input }) => listDays(ctx.env.DB, input)),
    save: authed.input(z.object({
      date: dateSchema,
      doc: daySchema,
      base: z.string().nullable(),
    }).refine(({ date, doc }) => doc.date === date, "doc.date does not match date")
      .refine(({ doc }) => JSON.stringify(doc).length <= 512 * 1024, "Day is too large"))
      .mutation(({ ctx, input }) => putDay(ctx.env.DB, input.date, input.doc, input.base)),
  }),
  exercises: t.router({ library: authed.query(({ ctx }) => exerciseLibrary(ctx.env.DB)) }),
  backup: t.router({ export: authed.query(async ({ ctx }) => ({
    exportedAt: new Date().toISOString(),
    days: await exportAll(ctx.env.DB),
  })) }),
});

export type AppRouter = typeof appRouter;
