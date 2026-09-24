import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";

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
      onError: ({ error }) => console.error(error),
      responseMeta: () => ({ headers: { "Cache-Control": "no-store" } }),
    });
  },
} satisfies ExportedHandler<Env>;
