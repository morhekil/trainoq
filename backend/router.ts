import { t } from "./trpc";
import { authRouter } from "./features/auth/router";
import { daysRouter } from "./features/days/router";
import { exercisesRouter } from "./features/exercises/router";
import { backupRouter } from "./features/backup/router";

export const appRouter = t.router({ auth: authRouter, days: daysRouter, exercises: exercisesRouter, backup: backupRouter });

export type AppRouter = typeof appRouter;
