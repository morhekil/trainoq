import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { readGarminConnection } from "./features/garmin/connection";
import { syncGarminPage } from "./features/garmin/sync";

export default {
  fetch(req, env): Promise<Response> {
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
    const connection = await readGarminConnection(env.DB, env.APP_PASSWORD);
    if (connection?.row.status === "connected") await syncGarminPage(env.DB, env.APP_PASSWORD);
  },
} satisfies ExportedHandler<Env>;
