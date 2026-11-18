import { TRPCError } from "@trpc/server";
import { isAuthed } from "../auth/auth";
import { encryptTokens, hash } from "./secrets";
import { requestWithingsTokens } from "./remote";
import type {} from "./env";

export function withingsConfig(env: Env) {
  if (!env.WITHINGS_CLIENT_ID || !env.WITHINGS_CLIENT_SECRET) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Withings is not configured. Ask the app owner to finish Withings setup." });
  return { WITHINGS_CLIENT_ID: env.WITHINGS_CLIENT_ID, WITHINGS_CLIENT_SECRET: env.WITHINGS_CLIENT_SECRET };
}
const redirectUri = (req: Request) => new URL("/api/withings/callback", req.url).href;
const stateCookie = (req: Request, state: string, maxAge: number) => `tq_withings_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${new URL(req.url).protocol === "https:" ? "; Secure" : ""}`;

export async function authorizeWithings(req: Request, headers: Headers, env: Env) {
  const config = withingsConfig(env);
  const state = crypto.randomUUID();
  await env.DB.prepare("DELETE FROM withings_oauth WHERE expires_at < ?").bind(Date.now()).run();
  await env.DB.prepare("INSERT INTO withings_oauth (state_hash, expires_at) VALUES (?, ?)").bind(await hash(state), Date.now() + 10 * 60_000).run();
  headers.append("Set-Cookie", stateCookie(req, state, 600));
  const url = new URL("https://account.withings.com/oauth2_user/authorize2");
  url.search = new URLSearchParams({ response_type: "code", client_id: config.WITHINGS_CLIENT_ID, redirect_uri: redirectUri(req), scope: "user.metrics", state }).toString();
  return { url: url.href };
}

export async function withingsCallback(req: Request, env: Env): Promise<Response> {
  const headers = new Headers({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  if (req.method === "HEAD") return new Response(null, { headers });
  if (!(await isAuthed(req, env))) return new Response("Sign in to Trainoq, then reconnect Withings from the menu.", { status: 401, headers });
  const params = new URL(req.url).searchParams;
  const state = params.get("state");
  const cookie = (req.headers.get("Cookie") ?? "").split(";").map((part) => part.trim()).find((part) => part.startsWith("tq_withings_state="))?.slice("tq_withings_state=".length);
  if (!state || state !== cookie || !await env.DB.prepare("DELETE FROM withings_oauth WHERE state_hash = ? AND expires_at > ? RETURNING state_hash").bind(await hash(state), Date.now()).first())
    return new Response("Withings authorization expired. Reconnect Withings from the Trainoq menu.", { status: 400, headers });
  headers.set("Set-Cookie", stateCookie(req, "", 0));
  let location = "/#/withings";
  try {
    const code = params.get("code");
    if (!code || params.has("error")) throw new Error("Authorization cancelled");
    const tokens = await requestWithingsTokens(withingsConfig(env), { grant_type: "authorization_code", code, redirect_uri: redirectUri(req) });
    const result = await env.DB.prepare(`INSERT INTO withings_connection (id, user_id, encrypted_tokens) VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id, encrypted_tokens = excluded.encrypted_tokens,
        last_update = 0, next_offset = 0, sweep_update = NULL, last_sync_at = NULL, last_error = NULL
      WHERE lock_until IS NULL OR lock_until < ?`).bind(tokens.userId, await encryptTokens(tokens, env.APP_PASSWORD), Date.now()).run();
    if (result.meta.changes !== 1) throw new Error("Sync running");
  } catch { location = "/#/withings?error=authorization"; }
  headers.set("Location", location);
  return new Response(null, { status: 303, headers });
}
