import { z } from "zod";
import { t } from "../../trpc";
import { authed } from "../auth/router";
import { catalog, createExercise, deleteTemplate, exerciseHistory, exerciseLibrary, saveTemplate, setExerciseParams } from "./db";
import { nameKey } from "../../../shared/exercises/model";
import { paramSetSchema } from "../../../shared/days/schema";

export const exercisesRouter = t.router({
  library: authed.query(({ ctx }) => exerciseLibrary(ctx.env.DB)),
  catalog: authed.query(({ ctx }) => catalog(ctx.env.DB)),
  create: authed.input(z.object({ id: z.string().min(1), name: z.string().trim().min(1).max(200) })
    .refine(({ id, name }) => z.uuid().safeParse(id).success || id === `legacy:${nameKey(name)}`, "Invalid exercise ID"))
    .mutation(({ ctx, input }) => createExercise(ctx.env.DB, input)),
  setParams: authed.input(z.object({ exerciseId: z.string().min(1), params: paramSetSchema, updatedAt: z.iso.datetime() }))
    .mutation(({ ctx, input }) => setExerciseParams(ctx.env.DB, input)),
  history: authed.input(z.object({ exerciseId: z.string().min(1) }))
    .query(({ ctx, input }) => exerciseHistory(ctx.env.DB, input.exerciseId)),
  saveTemplate: authed.input(z.object({ id: z.uuid(), name: z.string().trim().min(1).max(60), params: paramSetSchema }))
    .mutation(({ ctx, input }) => saveTemplate(ctx.env.DB, input)),
  deleteTemplate: authed.input(z.object({ id: z.uuid() }))
    .mutation(({ ctx, input }) => deleteTemplate(ctx.env.DB, input.id)),
});
