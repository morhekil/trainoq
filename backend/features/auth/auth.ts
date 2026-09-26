// Single-user auth: one password (APP_PASSWORD secret) -> long-lived signed cookie.

const COOKIE = "tq_session";
const MAX_AGE_S = 60 * 60 * 24 * 365;
const enc = new TextEncoder();

function b64url(buf: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
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
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

function cookieHeader(value: string, maxAge: number, secure: boolean): string {
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

export async function sessionCookie(password: string, req: Request, env: Env): Promise<string | null> {
  if (!env.APP_PASSWORD) throw new Error("APP_PASSWORD is not configured on the server");
  if (!(await passwordMatches(password, env.APP_PASSWORD))) {
    await new Promise((r) => setTimeout(r, 400)); // slow down guessing a little
    return null;
  }
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_S;
  const sig = await crypto.subtle.sign("HMAC", await key(env.APP_PASSWORD), enc.encode(`v1.${exp}`));
  const secure = new URL(req.url).protocol === "https:";
  return cookieHeader(`${exp}.${b64url(sig)}`, MAX_AGE_S, secure);
}

export function clearSessionCookie(req: Request): string {
  const secure = new URL(req.url).protocol === "https:";
  return cookieHeader("", 0, secure);
}
