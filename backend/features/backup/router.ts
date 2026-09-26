import { t } from "../../trpc";
import { authed } from "../auth/router";
import { exportAll } from "./db";

export const backupRouter = t.router({
  export: authed.query(async ({ ctx }) => ({
    exportedAt: new Date().toISOString(),
    days: await exportAll(ctx.env.DB),
  })),
});
