import { expect, it } from "vitest";
import { Encoder, Profile, type ActivityMesg, type FileIdMesg, type SessionMesg } from "@garmin/fitsdk";
import { parseGarminFit } from "../shared/garmin/fit";

const run = Uint8Array.from(Buffer.from("DgLhUpUAAAAuRklURV5AAAAAAAUAAQIBAoQCAoQDBIwEBIYABAEAAQB7AAAAPXUcRUEAABIADP4ChAIEhv0EhgUBAgYBAm4EBwcEhggEhgsChMQChAABAgEBAgEAAD11HEVWexxFAQBSdW4A+9IXAPvSFwDPACMACAFCAAAiAAb9BIYFBIYBAoQABIYDAQIEAQICPXUcRd0BHUUBAPvSFwAaAVfl", "base64"));

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

it("uses the activity timestamp to interpret local time across midnight", () => {
  const start = new Date("2026-09-27T14:30:00.000Z");
  const end = new Date("2026-09-27T15:00:00.000Z");
  const encoder = new Encoder();
  encoder.onMesg(Profile.MesgNum.FILE_ID, { type: "activity", manufacturer: "garmin", product: 1, serialNumber: 123, timeCreated: start } as FileIdMesg);
  encoder.onMesg(Profile.MesgNum.SESSION, {
    messageIndex: 0, startTime: start, timestamp: end, sport: "walking", subSport: "generic",
    totalElapsedTime: 1800, totalTimerTime: 1800, totalCalories: 100, metabolicCalories: 20,
  } as SessionMesg);
  encoder.onMesg(Profile.MesgNum.ACTIVITY, {
    timestamp: end, localTimestamp: (Date.parse("2026-09-28T01:00:00.000Z") - Date.UTC(1989, 11, 31)) / 1000,
    numSessions: 1, totalTimerTime: 1800, event: "activity", eventType: "stop",
  } as ActivityMesg);
  expect(parseGarminFit(encoder.close()).activities[0]).toMatchObject({ localDate: "2026-09-28", offsetMinutes: 600, activeCalories: 80 });
});

it("rejects a session without its source resting calorie field", () => {
  const start = new Date("2026-09-28T01:22:05.000Z");
  const encoder = new Encoder();
  encoder.onMesg(Profile.MesgNum.FILE_ID, { type: "activity", manufacturer: "garmin", product: 1, serialNumber: 123, timeCreated: start } as FileIdMesg);
  encoder.onMesg(Profile.MesgNum.SESSION, { messageIndex: 0, startTime: start, sport: "running", totalCalories: 207 } as SessionMesg);
  expect(parseGarminFit(encoder.close())).toEqual({ activities: [], rejected: ["Session 1: missing or inconsistent calorie fields"] });
});
