// Single-user auth: one password (APP_PASSWORD secret) -> long-lived signed cookie.

const COOKIE = "tq_session";
const MAX_AGE_S = 60 * 60 * 24 * 365;
const enc = new TextEncoder();

function b64url(buf: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode("trainoq-session:" + secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("Cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

export async function isAuthed(req: Request, env: Env): Promise<boolean> {
  if (!env.APP_PASSWORD) return false;
  const raw = readCookie(req, COOKIE);
  if (!raw) return false;
  const [expStr, sig] = raw.split(".");
  const exp = Number(expStr);
  if (!exp || !sig || exp < Date.now() / 1000) return false;
  try {
    return await crypto.subtle.verify("HMAC", await key(env.APP_PASSWORD), fromB64url(sig), enc.encode(`v1.${exp}`));
  } catch {
    return false;
  }
}

async function passwordMatches(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(given)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

function cookieHeader(value: string, maxAge: number, secure: boolean): string {
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

export async function login(req: Request, env: Env): Promise<Response> {
  if (!env.APP_PASSWORD) {
    return Response.json({ error: "APP_PASSWORD is not configured on the server" }, { status: 500 });
  }
  let password = "";
  try {
    password = String(((await req.json()) as { password?: unknown }).password ?? "");
  } catch {
    /* empty */
  }
  if (!(await passwordMatches(password, env.APP_PASSWORD))) {
    await new Promise((r) => setTimeout(r, 400)); // slow down guessing a little
    return Response.json({ error: "Wrong password" }, { status: 401 });
  }
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_S;
  const sig = await crypto.subtle.sign("HMAC", await key(env.APP_PASSWORD), enc.encode(`v1.${exp}`));
  const secure = new URL(req.url).protocol === "https:";
  return new Response(null, { status: 204, headers: { "Set-Cookie": cookieHeader(`${exp}.${b64url(sig)}`, MAX_AGE_S, secure) } });
}

export function logout(req: Request): Response {
  const secure = new URL(req.url).protocol === "https:";
  return new Response(null, { status: 204, headers: { "Set-Cookie": cookieHeader("", 0, secure) } });
}
