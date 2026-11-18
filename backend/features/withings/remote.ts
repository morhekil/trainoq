import { z } from "zod";
import type { WeightMeasurement } from "../../../shared/withings/model";

type Credentials = { WITHINGS_CLIENT_ID: string; WITHINGS_CLIENT_SECRET: string };
export type WithingsTokens = { userId: string; accessToken: string; refreshToken: string; expiresAt: number };
export class WithingsUnauthorizedError extends Error {
  constructor() { super("Withings authorization expired. Reconnect Withings to resume syncing."); }
}

async function post(path: string, params: Record<string, string>, accessToken?: string, fetcher: typeof fetch = fetch): Promise<unknown> {
  let response;
  try {
    response = await fetcher(`https://wbsapi.withings.net/${path}`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      body: new URLSearchParams(params), signal: AbortSignal.timeout(30_000),
    });
  } catch { throw new Error("Unable to reach Withings. Retry sync shortly."); }
  if (response.status === 401) throw new WithingsUnauthorizedError();
  if (!response.ok) throw new Error(`Withings request failed (HTTP ${response.status}). Retry sync shortly.`);
  let payload;
  try { payload = z.object({ status: z.number(), body: z.unknown().optional() }).parse(await response.json()); }
  catch { throw new Error("Withings returned invalid data. Retry sync shortly."); }
  if (payload.status === 401) throw new WithingsUnauthorizedError();
  if (payload.status !== 0) throw new Error(`Withings request failed (status ${payload.status}). Retry or reconnect Withings.`);
  return payload.body;
}

const id = z.union([z.number().int().positive().max(Number.MAX_SAFE_INTEGER), z.string().regex(/^\d+$/)]).transform(String);
const tokensSchema = z.object({ userid: id, access_token: z.string().min(1), refresh_token: z.string().min(1), expires_in: z.number().int().positive(), scope: z.string() })
  .refine((tokens) => tokens.scope.split(",").includes("user.metrics"), "Withings needs measurement access");

export async function requestWithingsTokens(env: Credentials, grant: { grant_type: "authorization_code"; code: string; redirect_uri: string } | { grant_type: "refresh_token"; refresh_token: string }, fetcher: typeof fetch = fetch): Promise<WithingsTokens> {
  const tokens = tokensSchema.parse(await post("v2/oauth2", { action: "requesttoken", client_id: env.WITHINGS_CLIENT_ID, client_secret: env.WITHINGS_CLIENT_SECRET, ...grant }, undefined, fetcher));
  return { userId: tokens.userid, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: Date.now() + tokens.expires_in * 1000 };
}

const pageSchema = z.object({
  updatetime: z.union([z.number(), z.string().regex(/^\d+$/).transform(Number)]).pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)),
  timezone: z.string().min(1), more: z.union([z.literal(0), z.literal(1)]).default(0), offset: z.number().int().nonnegative().optional(),
  measuregrps: z.array(z.object({ grpid: id, date: z.number().int().nonnegative(), category: z.number().int(),
    measures: z.array(z.object({ type: z.number().int(), value: z.number().finite(), unit: z.number().int() })),
  })),
}).refine((page) => !page.more || page.offset !== undefined, "Missing Withings page cursor");

export function parseWeightPage(body: unknown, userId: string) {
  const page = pageSchema.parse(body);
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: page.timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  const items: WeightMeasurement[] = [];
  for (const group of page.measuregrps) {
    if (group.category !== 1) continue;
    const weight = group.measures.find((measure) => measure.type === 1);
    if (!weight) continue;
    const weightKg = Number((weight.value * 10 ** weight.unit).toPrecision(15));
    if (!Number.isFinite(weightKg) || weightKg <= 0) throw new Error("Invalid Withings weight. Retry sync after checking the reading in Withings.");
    const measuredAt = new Date(group.date * 1000).toISOString();
    items.push({ sourceId: `withings:${userId}:${group.grpid}`, userId, groupId: group.grpid, measuredAt, timezone: page.timezone,
      localDate: formatter.format(new Date(measuredAt)), weightKg });
  }
  return { items, updatedAt: page.updatetime, more: page.more === 1, offset: page.offset ?? 0 };
}

export async function fetchWeightPage(accessToken: string, userId: string, lastUpdate: number, offset: number, fetcher: typeof fetch = fetch) {
  return parseWeightPage(await post("measure", { action: "getmeas", meastype: "1", category: "1", lastupdate: String(lastUpdate), offset: String(offset) }, accessToken, fetcher), userId);
}
