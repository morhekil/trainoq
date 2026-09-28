import { zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import { downloadGarminFits, listGarminActivityIds, refreshGarminTokens } from "../backend/features/garmin/remote";

const tokens = { accessToken: "access", refreshToken: "refresh", clientId: "GARMIN_CONNECT_MOBILE_ANDROID_DI_2025Q2" };

describe("Garmin activity HTTP client", () => {
  it("lists activity IDs and unzips original FIT recordings", async () => {
    const fit = Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0, 46, 70, 73, 84]);
    const archive = zipSync({ "folder/activity.fit": fit, "metadata.txt": Uint8Array.from([1]) });
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify([{ activityId: 123 }, { activityId: 456 }])))
      .mockResolvedValueOnce(new Response(archive as BodyInit));

    expect(await listGarminActivityIds(tokens, 20, 100, fetcher)).toEqual(["123", "456"]);
    expect(await downloadGarminFits(tokens, "123", fetcher)).toEqual([fit]);
    expect(String(fetcher.mock.calls[0][0])).toContain("start=20&limit=100");
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe("Bearer access");
    expect(String(fetcher.mock.calls[1][0])).toContain("/download-service/files/activity/123");
  });

  it("refreshes an expired token and stops on provider rate limits", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "fresh", refresh_token: "next" })))
      .mockResolvedValueOnce(new Response("", { status: 429 }));
    expect(await refreshGarminTokens(tokens, fetcher)).toEqual({ ...tokens, accessToken: "fresh", refreshToken: "next" });
    await expect(listGarminActivityIds(tokens, 0, 20, fetcher)).rejects.toThrow("rate limited");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects an original export without FIT data", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(zipSync({ "activity.tcx": Uint8Array.from([1]) }) as BodyInit));
    await expect(downloadGarminFits(tokens, "123", fetcher)).rejects.toThrow("no FIT");
  });
});
