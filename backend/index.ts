import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { readGarminConnection } from "./features/garmin/connection";
import { syncGarminPage } from "./features/garmin/sync";
import { autoImportGarmin } from "./features/garmin/auto";
import { withingsCallback } from "./features/withings/oauth";
import { syncWithings } from "./features/withings/sync";
import { readConnection } from "./features/withings/db";

export default {
  fetch(req, env): Promise<Response> {
    if (new URL(req.url).pathname === "/api/withings/callback" && req.method === "GET") return withingsCallback(req, env);
    if (!new URL(req.url).pathname.startsWith("/api/trpc/")) {
      return Promise.resolve(new Response("Not found", { status: 404 }));
    }
    return fetchRequestHandler({
      endpoint: "/api/trpc",
      req,
      router: appRouter,
      createContext: ({ req, resHeaders }) => ({ req, resHeaders, env }),
      onError: ({ error }) => { if (error.code !== "UNAUTHORIZED") console.error(error); },
      responseMeta: () => ({ headers: { "Cache-Control": "no-store" } }),
    });
  },
  async scheduled(_event, env): Promise<void> {
    const jobs = await Promise.allSettled([
      (async () => {
        const connection = await readGarminConnection(env.DB, env.APP_PASSWORD);
        if (connection?.row.status === "connected") await syncGarminPage(env.DB, env.APP_PASSWORD);
        await autoImportGarmin(env.DB);
      })(),
      (async () => {
        if (env.WITHINGS_CLIENT_ID && env.WITHINGS_CLIENT_SECRET && await readConnection(env.DB)) await syncWithings(env);
      })(),
    ]);
    const failed = jobs.find((job) => job.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  },
} satisfies ExportedHandler<Env>;
