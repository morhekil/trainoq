import { z } from "zod";
import { dateSchema, inputDaySchema } from "../../../shared/days/schema";
import { t } from "../../trpc";
import { authed } from "../auth/router";
import { getDay, listDays, putDay } from "./db";

export const daysRouter = t.router({
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
    doc: inputDaySchema,
    base: z.string().nullable(),
  }).refine(({ date, doc }) => doc.date === date, "doc.date does not match date")
    .refine(({ doc }) => JSON.stringify(doc).length <= 512 * 1024, "Day is too large"))
    .mutation(({ ctx, input }) => putDay(ctx.env.DB, input.date, input.doc, input.base)),
});
