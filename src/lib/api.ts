export class NetworkError extends Error {}
export class AuthError extends Error {}

type AuthListener = () => void;
const authListeners = new Set<AuthListener>();
export function onAuthRequired(fn: AuthListener): () => void {
  authListeners.add(fn);
  return () => authListeners.delete(fn);
}

export async function api(path: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: "same-origin",
      ...init,
      headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
  } catch (e) {
    throw new NetworkError(String(e));
  }
  if (res.status === 401 && path !== "/api/login") {
    authListeners.forEach((fn) => fn());
    throw new AuthError("Not signed in");
  }
  return res;
}
