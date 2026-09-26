import { initTRPC } from "@trpc/server";

export interface Context {
  req: Request;
  resHeaders: Headers;
  env: Env;
}

export const t = initTRPC.context<Context>().create();
