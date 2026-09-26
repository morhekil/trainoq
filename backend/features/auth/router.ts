import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { t } from "../../trpc";
import { clearSessionCookie, isAuthed, sessionCookie } from "./auth";

export const authed = t.procedure.use(async ({ ctx, next }) => {
  if (!(await isAuthed(ctx.req, ctx.env))) throw new TRPCError({ code: "UNAUTHORIZED", message: "Not signed in" });
  return next();
});

export const authRouter = t.router({
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
});
