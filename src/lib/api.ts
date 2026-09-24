import { createTRPCClient, httpLink, TRPCClientError } from "@trpc/client";
import type { AppRouter } from "../../worker/router";

export class NetworkError extends Error {}
export class AuthError extends Error {}

const authListeners = new Set<() => void>();
export function onAuthRequired(fn: () => void): () => void {
  authListeners.add(fn);
  return () => authListeners.delete(fn);
}

export const trpc = createTRPCClient<AppRouter>({
  links: [httpLink({
    url: "/api/trpc",
    fetch: (url, init) => fetch(url, { ...init, credentials: "same-origin", keepalive: document.visibilityState === "hidden" }),
  })],
});

export async function request<T>(call: Promise<T>, allowUnauthorized = false): Promise<T> {
  try {
    return await call;
  } catch (err) {
    if (err instanceof TRPCClientError) {
      if (err.data?.code === "UNAUTHORIZED") {
        if (!allowUnauthorized) authListeners.forEach((fn) => fn());
        throw new AuthError(err.message);
      }
      if (!err.data) throw new NetworkError(err.message);
    }
    throw err;
  }
}
