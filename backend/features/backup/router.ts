import { t } from "../../trpc";
import { authed } from "../auth/router";
import { exportAll } from "./db";
import { catalog } from "../exercises/db";
import { allGarmin } from "../garmin/db";

export const backupRouter = t.router({
  export: authed.query(async ({ ctx }) => ({
    exportedAt: new Date().toISOString(),
    days: await exportAll(ctx.env.DB),
    catalog: await catalog(ctx.env.DB),
    garminActivities: await allGarmin(ctx.env.DB),
    exerciseParams: (await ctx.env.DB.prepare("SELECT exercise_id, params, updated_at FROM exercise_params ORDER BY exercise_id")
      .all<{ exercise_id: string; params: string; updated_at: string }>()).results.map((row) => ({ exerciseId: row.exercise_id, params: JSON.parse(row.params), updatedAt: row.updated_at })),
  })),
});
