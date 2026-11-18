import type { WithingsTokens } from "./remote";

const encoder = new TextEncoder();
export async function hash(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function key(secret: string) {
  if (!secret) throw new Error("APP_PASSWORD is required to protect Withings tokens");
  return crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", encoder.encode(`trainoq-withings:v1:${secret}`)), "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function encryptTokens(tokens: WithingsTokens, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(secret), encoder.encode(JSON.stringify(tokens))));
  const bytes = new Uint8Array(iv.length + encrypted.length); bytes.set(iv); bytes.set(encrypted, iv.length);
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
}
export async function decryptTokens(value: string, secret: string): Promise<WithingsTokens> {
  const bytes = Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, await key(secret), bytes.slice(12));
  return JSON.parse(new TextDecoder().decode(decrypted)) as WithingsTokens;
}
