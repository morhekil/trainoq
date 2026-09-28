import { describe, expect, it } from "vitest";
import { decryptGarminState, encryptGarminState } from "../backend/features/garmin/secrets";

describe("stored Garmin connection", () => {
  it("round trips account secrets with fresh authenticated encryption", async () => {
    const state = { email: "me@example.com", password: "private-password", tokens: {
      accessToken: "access", refreshToken: "refresh", clientId: "client",
    } };
    const first = await encryptGarminState(state, "app-secret");
    const second = await encryptGarminState(state, "app-secret");
    expect(first).not.toBe(second);
    expect(first).not.toContain("private-password");
    expect(first).not.toContain("refresh");
    expect(await decryptGarminState(first, "app-secret")).toEqual(state);
    await expect(decryptGarminState(first, "different-secret")).rejects.toThrow();
    await expect(decryptGarminState(first.slice(0, -4) + "AAAA", "app-secret")).rejects.toThrow();
  });
});
