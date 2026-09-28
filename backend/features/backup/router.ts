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
  })),
});
