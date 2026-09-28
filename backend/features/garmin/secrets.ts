import type { GarminTokens, PendingGarminMfa } from "./connect";

export interface GarminStoredState {
  email: string;
  password: string;
  tokens?: GarminTokens;
  pending?: PendingGarminMfa;
}

const encoder = new TextEncoder();

async function key(secret: string): Promise<CryptoKey> {
  if (!secret) throw new Error("APP_PASSWORD is required to protect Garmin credentials");
  const material = await crypto.subtle.digest("SHA-256", encoder.encode(`trainoq-garmin:v1:${secret}`));
  return crypto.subtle.importKey("raw", material, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function base64(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

function unbase64(text: string): Uint8Array<ArrayBuffer> {
  const raw = atob(text);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export async function encryptGarminState(state: GarminStoredState, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(secret), encoder.encode(JSON.stringify(state))));
  const payload = new Uint8Array(iv.length + ciphertext.length);
  payload.set(iv);
  payload.set(ciphertext, iv.length);
  return base64(payload);
}

export async function decryptGarminState(encrypted: string, secret: string): Promise<GarminStoredState> {
  const payload = unbase64(encrypted);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: payload.slice(0, 12) }, await key(secret), payload.slice(12));
  return JSON.parse(new TextDecoder().decode(plaintext)) as GarminStoredState;
}
