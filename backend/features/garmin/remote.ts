import { unzipSync } from "fflate";
import type { GarminTokens } from "./connect";

const api = "https://connectapi.garmin.com";
const tokenUrl = "https://diauth.garmin.com/di-oauth2-service/oauth/token";
const maxFitBytes = 64 * 1024 * 1024;
type Fetcher = typeof fetch;

export class GarminUnauthorizedError extends Error {}
export class GarminUnusableExportError extends Error {}

function apiHeaders(tokens: GarminTokens, accept: string) {
  return { Authorization: `Bearer ${tokens.accessToken}`, Accept: accept, "User-Agent": "GCM-Android-5.23",
    "X-Garmin-User-Agent": "com.garmin.android.apps.connectmobile/5.23; Android/33", "X-Garmin-Client-Platform": "Android" };
}

function checkResponse(response: Response): void {
  if (response.status === 401) throw new GarminUnauthorizedError("Garmin session expired.");
  if (response.status === 429) throw new Error("Garmin rate limited activity sync. Try again later.");
  if (!response.ok) throw new Error(`Garmin activity request returned HTTP ${response.status}.`);
}

export async function refreshGarminTokens(tokens: GarminTokens, fetcher: Fetcher = fetch): Promise<GarminTokens> {
  const response = await fetcher(tokenUrl, { method: "POST", headers: {
    Authorization: `Basic ${btoa(`${tokens.clientId}:`)}`, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded",
  }, body: new URLSearchParams({ grant_type: "refresh_token", client_id: tokens.clientId,
    refresh_token: tokens.refreshToken }).toString() });
  if (response.status === 400) throw new GarminUnauthorizedError("Garmin refresh token expired.");
  checkResponse(response);
  const data: unknown = await response.json();
  if (!data || typeof data !== "object" || !("access_token" in data) || typeof data.access_token !== "string")
    throw new Error("Garmin did not return a refreshed token.");
  return { accessToken: data.access_token, refreshToken: "refresh_token" in data && typeof data.refresh_token === "string"
    ? data.refresh_token : tokens.refreshToken, clientId: tokens.clientId };
}

export async function listGarminActivityIds(tokens: GarminTokens, start: number, limit: number, startDate: string, fetcher: Fetcher = fetch): Promise<string[]> {
  const url = `${api}/activitylist-service/activities/search/activities?${new URLSearchParams({ start: String(start), limit: String(limit), startDate })}`;
  const response = await fetcher(url, { headers: apiHeaders(tokens, "application/json") });
  checkResponse(response);
  const data: unknown = await response.json();
  if (!Array.isArray(data)) throw new Error("Garmin returned an invalid activity list.");
  return data.map((item) => {
    const id = item && typeof item === "object" && "activityId" in item ? String(item.activityId) : "";
    if (!/^[1-9]\d*$/.test(id)) throw new Error("Garmin returned an invalid activity ID.");
    return id;
  });
}

export async function downloadGarminFits(tokens: GarminTokens, activityId: string, fetcher: Fetcher = fetch): Promise<Uint8Array[]> {
  if (!/^[1-9]\d*$/.test(activityId)) throw new Error("Invalid Garmin activity ID.");
  const response = await fetcher(`${api}/download-service/files/activity/${activityId}`, { headers: apiHeaders(tokens, "*/*") });
  if ([400, 404, 410].includes(response.status)) throw new GarminUnusableExportError("Garmin original export is unavailable.");
  checkResponse(response);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > maxFitBytes) throw new GarminUnusableExportError("Garmin activity export exceeds 64 MiB.");
  if (bytes[8] === 46 && bytes[9] === 70 && bytes[10] === 73 && bytes[11] === 84) return [bytes];
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (file) => file.name.toLowerCase().endsWith(".fit") && file.originalSize <= maxFitBytes });
  } catch { throw new GarminUnusableExportError("Garmin returned an invalid original export."); }
  const fits = Object.values(files);
  if (!fits.length) throw new GarminUnusableExportError("Garmin original export has no FIT file.");
  return fits;
}
