import { afterEach, expect, it, vi } from "vitest";
import { atClock, clockTime, deviceOffset, formatOffset, formatTime, nowLocal, withClock, withOffset } from "../shared/days/time";
import { homeTime } from "../shared/days/migrate";

afterEach(() => { vi.unstubAllEnvs(); });

it("reads and formats the stored clock time without converting time zones", () => {
  expect(clockTime("2026-10-02T16:24:07+10:00")).toBe("16:24");
  expect(clockTime("2026-10-02T16:24:07-04:00")).toBe("16:24");
  expect(formatTime("2026-10-02T17:02:00+10:00")).toBe("5:02pm");
  expect(formatTime("2026-10-02T00:05:00-04:00")).toBe("12:05am");
  expect(formatTime("2026-10-02T12:00:00+05:30")).toBe("12:00pm");
});

it("builds offset timestamps from a clock time or a UTC instant", () => {
  expect(atClock("2026-10-05", "07:30", "+11:00")).toBe("2026-10-05T07:30:00+11:00");
  expect(withClock("2026-09-28T16:24:07+05:30", "07:05")).toBe("2026-09-28T07:05:00+05:30");
  expect(withOffset("2026-10-02T06:24:07.000Z", "+10:00")).toBe("2026-10-02T16:24:07+10:00");
  expect(withOffset("2026-10-01T23:30:00.000Z", "-03:30")).toBe("2026-10-01T20:00:00-03:30");
  expect(withOffset("2026-10-01T22:00:00Z", "+05:45")).toBe("2026-10-02T03:45:00+05:45");
  expect([600, 330, -210, 0].map(formatOffset)).toEqual(["+10:00", "+05:30", "-03:30", "+00:00"]);
});

it("uses the device offset in force at that local time, across daylight saving", () => {
  vi.stubEnv("TZ", "Australia/Sydney");
  expect(deviceOffset("2026-10-03", "12:00")).toBe("+10:00");
  expect(deviceOffset("2026-10-04", "12:00")).toBe("+11:00");
  expect(nowLocal(new Date("2026-10-02T06:24:07.123Z"))).toBe("2026-10-02T16:24:07+10:00");
  expect(nowLocal(new Date("2026-10-05T07:00:00.000Z"))).toBe("2026-10-05T18:00:00+11:00");
  vi.stubEnv("TZ", "America/New_York");
  expect(nowLocal(new Date("2026-10-05T07:00:00.000Z"))).toBe("2026-10-05T03:00:00-04:00");
});

it("converts a saved UTC instant to the Sydney offset in force at that moment", () => {
  vi.stubEnv("TZ", "UTC");
  expect(homeTime("2026-10-02T06:24:07.000Z")).toBe("2026-10-02T16:24:07+10:00");
  expect(homeTime("2026-10-05T07:00:00.000Z")).toBe("2026-10-05T18:00:00+11:00");
  expect(homeTime("2026-10-03T15:59:59Z")).toBe("2026-10-04T01:59:59+10:00");
  expect(homeTime("2026-10-03T16:00:00Z")).toBe("2026-10-04T03:00:00+11:00");
});
