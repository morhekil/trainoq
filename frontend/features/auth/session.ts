export class AuthError extends Error {}

const listeners = new Set<() => void>();

export function onAuthRequired(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function authRequired(): void {
  listeners.forEach((fn) => fn());
}
