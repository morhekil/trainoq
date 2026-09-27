import { z } from "zod";
import { t } from "../../trpc";
import { authed } from "../auth/router";
import { catalog, createExercise, exerciseLibrary } from "./db";
import { nameKey } from "../../../shared/exercises/model";

export const exercisesRouter = t.router({
  library: authed.query(({ ctx }) => exerciseLibrary(ctx.env.DB)),
  catalog: authed.query(({ ctx }) => catalog(ctx.env.DB)),
  create: authed.input(z.object({ id: z.string().min(1), name: z.string().trim().min(1).max(200) })
    .refine(({ id, name }) => z.uuid().safeParse(id).success || id === `legacy:${nameKey(name)}`, "Invalid exercise ID"))
    .mutation(({ ctx, input }) => createExercise(ctx.env.DB, input)),
});
