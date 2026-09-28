import { expect, it } from "vitest";
import { parseGarminFit } from "../shared/garmin/fit";

const run = Uint8Array.from(Buffer.from("DgLhUpUAAAAuRklURV5AAAAAAAUAAQIBAoQCAoQDBIwEBIYABAEAAQB7AAAAPXUcRUEAABIADP4ChAIEhv0EhgUBAgYBAm4EBwcEhggEhgsChMQChAABAgEBAgEAAD11HEVWexxFAQBSdW4A+9IXAPvSFwDPACMACAFCAAAiAAb9BIYFBIYBAoQABIYDAQIEAQICVnscRd0BHUUBAPvSFwAaAbb+", "base64"));

it("reads verified per-session active calories and local time from an original FIT", () => {
  expect(parseGarminFit(run)).toEqual({
    activities: [{
      sourceKey: "garmin:123:2026-09-28T01:22:05.000Z:0",
      sport: "running", subSport: "generic", title: "Run",
      startUtc: "2026-09-28T01:22:05.000Z", localDate: "2026-09-28", offsetMinutes: 600,
      timerSeconds: 1561.339, elapsedSeconds: 1561.339, activeCalories: 172,
    }],
    rejected: [],
  });
});
