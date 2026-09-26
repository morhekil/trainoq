import { t } from "../../trpc";
import { authed } from "../auth/router";
import { exerciseLibrary } from "./db";

export const exercisesRouter = t.router({
  library: authed.query(({ ctx }) => exerciseLibrary(ctx.env.DB)),
});
