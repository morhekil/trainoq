const sso = "https://sso.garmin.com";
const service = "https://mobile.integration.garmin.com/gcm/ios";
const tokenUrl = "https://diauth.garmin.com/di-oauth2-service/oauth/token";
const clientIds = [
  "GARMIN_CONNECT_MOBILE_ANDROID_DI_2025Q2",
  "GARMIN_CONNECT_MOBILE_ANDROID_DI_2024Q4",
  "GARMIN_CONNECT_MOBILE_ANDROID_DI",
  "GARMIN_CONNECT_MOBILE_IOS_DI",
];
const loginParams = new URLSearchParams({ clientId: "GCM_IOS_DARK", locale: "en-US", service });
const loginHeaders = { "User-Agent": "GCM-iOS-5.23", Accept: "application/json, text/plain, */*", "Content-Type": "application/json", Origin: sso };

export interface GarminTokens { accessToken: string; refreshToken: string; clientId: string }
export interface PendingGarminMfa { email: string; password: string; cookie: string; method: string }
export class GarminSignInError extends Error {}
type Fetcher = typeof fetch;

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  if (response.status === 429) throw new Error("Garmin rate limited sign-in. Try again later.");
  if (response.status === 403) throw new GarminSignInError("Garmin blocked sign-in from this server.");
  if (!response.ok) throw new Error(`Garmin sign-in returned HTTP ${response.status}.`);
  try {
    const data: unknown = await response.json();
    if (data && typeof data === "object" && !Array.isArray(data)) return data as Record<string, unknown>;
  } catch { /* handled below */ }
  throw new Error("Garmin returned an unexpected sign-in response.");
}

function responseType(data: Record<string, unknown>): string | null {
  const status = data.responseStatus;
  return status && typeof status === "object" && "type" in status && typeof status.type === "string" ? status.type : null;
}

async function exchangeTicket(ticket: string, fetcher: Fetcher): Promise<GarminTokens> {
  for (const clientId of clientIds) {
    const response = await fetcher(tokenUrl, { method: "POST", headers: {
      Authorization: `Basic ${btoa(`${clientId}:`)}`, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded",
    }, body: new URLSearchParams({ client_id: clientId, service_ticket: ticket,
      grant_type: "https://connectapi.garmin.com/di-oauth2-service/oauth/grant/service_ticket", service_url: service }).toString() });
    if (response.status === 429) throw new Error("Garmin rate limited sign-in. Try again later.");
    if (!response.ok) continue;
    const data = await responseJson(response);
    if (typeof data.access_token === "string" && typeof data.refresh_token === "string")
      return { accessToken: data.access_token, refreshToken: data.refresh_token, clientId };
  }
  throw new Error("Garmin did not issue an activity access token.");
}

function ticket(data: Record<string, unknown>): string {
  if (typeof data.serviceTicketId !== "string" || !data.serviceTicketId) throw new Error("Garmin did not return a service ticket.");
  return data.serviceTicketId;
}

export async function loginGarmin(email: string, password: string, fetcher: Fetcher = fetch): Promise<
  { kind: "connected"; tokens: GarminTokens } | { kind: "mfa"; pending: PendingGarminMfa }
> {
  const response = await fetcher(`${sso}/mobile/api/login?${loginParams}`, { method: "POST", headers: loginHeaders,
    body: JSON.stringify({ username: email, password, rememberMe: true, captchaToken: "" }) });
  const data = await responseJson(response);
  const type = responseType(data);
  if (type === "SUCCESSFUL") return { kind: "connected", tokens: await exchangeTicket(ticket(data), fetcher) };
  if (type === "MFA_REQUIRED") {
    const info = data.customerMfaInfo;
    const method = info && typeof info === "object" && "mfaLastMethodUsed" in info && typeof info.mfaLastMethodUsed === "string"
      ? info.mfaLastMethodUsed : "email";
    const cookie = response.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
    return { kind: "mfa", pending: { email, password, cookie, method } };
  }
  if (type === "INVALID_USERNAME_PASSWORD") throw new GarminSignInError("Garmin rejected the email or password.");
  if (type === "CAPTCHA_REQUIRED") throw new GarminSignInError("Garmin requires a browser challenge to sign in.");
  throw new Error("Garmin could not complete sign-in.");
}

export async function verifyGarminMfa(pending: PendingGarminMfa, code: string, fetcher: Fetcher = fetch): Promise<GarminTokens> {
  const response = await fetcher(`${sso}/mobile/api/mfa/verifyCode?${loginParams}`, { method: "POST", headers: {
    ...loginHeaders, Cookie: pending.cookie,
  }, body: JSON.stringify({ mfaMethod: pending.method, mfaVerificationCode: code,
    rememberMyBrowser: true, reconsentList: [], mfaSetup: false }) });
  const data = await responseJson(response);
  if (responseType(data) !== "SUCCESSFUL") throw new Error("Garmin did not accept the verification code.");
  return exchangeTicket(ticket(data), fetcher);
}
