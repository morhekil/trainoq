import { expect, it, vi } from "vitest";
import { parseWeightPage, requestWithingsTokens, fetchWeightPage } from "../backend/features/withings/remote";

const body = { updatetime: 1794950000, timezone: "Australia/Sydney", more: 1, offset: 100, measuregrps: [
  { grpid: 12, date: 1794949200, category: 1, measures: [{ type: 1, value: 82500, unit: -3 }, { type: 6, value: 200, unit: -1 }] },
  { grpid: 13, date: 1794952800, category: 1, measures: [{ type: 1, value: 824, unit: -1 }] },
  { grpid: 14, date: 1794952800, category: 2, measures: [{ type: 1, value: 80, unit: 0 }] },
] };

it("keeps every real weigh-in in kilograms, with stable account-scoped IDs and the source's local day", () => {
  const page = parseWeightPage(body, "7");
  expect(page).toMatchObject({ updatedAt: 1794950000, more: true, offset: 100 });
  expect(page.items).toEqual([
    { sourceId: "withings:7:12", userId: "7", groupId: "12", measuredAt: "2026-11-17T21:00:00.000Z", timezone: "Australia/Sydney", localDate: "2026-11-18", weightKg: 82.5 },
    { sourceId: "withings:7:13", userId: "7", groupId: "13", measuredAt: "2026-11-17T22:00:00.000Z", timezone: "Australia/Sydney", localDate: "2026-11-18", weightKg: 82.4 },
  ]);
});

it("accepts the numeric-string update timestamp documented by Withings", () => {
  expect(parseWeightPage({ ...body, updatetime: "1794950000" }, "7").updatedAt).toBe(1794950000);
  expect(() => parseWeightPage({ ...body, updatetime: "invalid" }, "7")).toThrow();
});

it.each([
  { ...body, timezone: "unknown" },
  { ...body, measuregrps: [{ ...body.measuregrps[0], date: -1 }] },
  { ...body, measuregrps: [{ ...body.measuregrps[0], measures: [{ type: 1, value: 0, unit: 0 }] }] },
  { ...body, measuregrps: [{ ...body.measuregrps[0], measures: [{ type: 1, value: 1, unit: 999 }] }] },
  { ...body, more: 1, offset: undefined },
])("rejects malformed source data without silently losing a reading", (invalid) => {
  expect(() => parseWeightPage(invalid, "7")).toThrow();
});

it("exchanges authorization codes and rotated refresh tokens using the official form endpoint", async () => {
  const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ status: 0, body: {
    userid: 7, access_token: "access", refresh_token: "next", expires_in: 10800, scope: "user.metrics", token_type: "Bearer",
  } })));
  const env = { WITHINGS_CLIENT_ID: "client", WITHINGS_CLIENT_SECRET: "secret" };
  expect(await requestWithingsTokens(env, { grant_type: "authorization_code", code: "code", redirect_uri: "https://trainoq.test/api/withings/callback" }, fetcher))
    .toMatchObject({ userId: "7", accessToken: "access", refreshToken: "next", expiresAt: expect.any(Number) });
  await requestWithingsTokens(env, { grant_type: "refresh_token", refresh_token: "previous" }, fetcher);
  const [url, init] = fetcher.mock.calls[1];
  expect(url).toBe("https://wbsapi.withings.net/v2/oauth2");
  expect(Object.fromEntries(new URLSearchParams(init.body))).toEqual({ action: "requesttoken", client_id: "client", client_secret: "secret", grant_type: "refresh_token", refresh_token: "previous" });
});

it("requests actual weight with incremental and pagination cursors, and never puts tokens in URLs", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 0, body })));
  await fetchWeightPage("access", "7", 123, 100, fetcher);
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toBe("https://wbsapi.withings.net/measure");
  expect(init.headers.Authorization).toBe("Bearer access");
  expect(Object.fromEntries(new URLSearchParams(init.body))).toEqual({ action: "getmeas", meastype: "1", category: "1", lastupdate: "123", offset: "100" });
});

it.each([new Response("rate limited", { status: 429 }), new Response(JSON.stringify({ status: 401, error: "private provider detail" })), new Response("invalid json")])
  ("reports safe, retryable provider errors", async (response) => {
    const copy = response.clone();
    await expect(fetchWeightPage("access", "7", 0, 0, vi.fn().mockResolvedValue(response))).rejects.toThrow(/Withings/);
    expect(await fetchWeightPage("access", "7", 0, 0, vi.fn().mockResolvedValue(copy)).catch((error) => error.message)).not.toContain("private provider detail");
  });
