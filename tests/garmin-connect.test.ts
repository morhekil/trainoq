import { describe, expect, it, vi } from "vitest";
import { loginGarmin, verifyGarminMfa } from "../backend/features/garmin/connect";

const json = (value: unknown, headers?: HeadersInit) => new Response(JSON.stringify(value), { status: 200, headers });

describe("Garmin account sign-in", () => {
  it("exchanges a successful Garmin sign-in ticket for refreshable tokens", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ responseStatus: { type: "SUCCESSFUL" }, serviceTicketId: "ST-1" }))
      .mockResolvedValueOnce(json({ access_token: "access", refresh_token: "refresh" }));

    const result = await loginGarmin("me@example.com", "private-password", fetcher);

    expect(result).toEqual({ kind: "connected", tokens: {
      accessToken: "access", refreshToken: "refresh", clientId: "GARMIN_CONNECT_MOBILE_ANDROID_DI_2025Q2",
    } });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[0][0])).toContain("/mobile/api/login?");
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ username: "me@example.com", password: "private-password" });
    expect(new URLSearchParams(fetcher.mock.calls[1][1].body).get("service_ticket")).toBe("ST-1");
  });

  it("keeps Garmin's MFA cookie for the second step", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ responseStatus: { type: "MFA_REQUIRED" }, customerMfaInfo: { mfaLastMethodUsed: "email" } }, { "Set-Cookie": "GARMIN-SSO=abc; Path=/; Secure" }))
      .mockResolvedValueOnce(json({ responseStatus: { type: "SUCCESSFUL" }, serviceTicketId: "ST-mfa" }))
      .mockResolvedValueOnce(json({ access_token: "new-access", refresh_token: "new-refresh" }));

    const start = await loginGarmin("me@example.com", "private-password", fetcher);
    expect(start.kind).toBe("mfa");
    if (start.kind !== "mfa") throw new Error("Expected MFA");
    const tokens = await verifyGarminMfa(start.pending, "123456", fetcher);

    expect(tokens.accessToken).toBe("new-access");
    expect(fetcher.mock.calls[1][1].headers.Cookie).toBe("GARMIN-SSO=abc");
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ mfaMethod: "email", mfaVerificationCode: "123456" });
  });

  it("stops on Garmin rate limits without trying more sign-ins", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 429 }));
    await expect(loginGarmin("me@example.com", "private-password", fetcher)).rejects.toThrow("rate limited");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
