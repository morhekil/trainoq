import { describe, expect, it } from "vitest";
import { activityName, activityStart, activityTotals, addEventEntry, emptyDay, removeEventEntry, type Activity, type DayDoc } from "../shared/days/model";
import { normalizeDay, type V8DayDoc } from "../shared/days/migrate";
import { daySchema, inputDaySchema } from "../shared/days/schema";

const fit = "garmin:3442:2026-10-02T06:24:07.000Z";
const v8: V8DayDoc = {
  v: 8, date: "2026-10-02", comments: [{ id: "c", time: "07:00", text: "Slept well" }], totalCalories: 900,
  ignoredGarminSourceKeys: ["garmin:1:2026-10-02T01:00:00.000Z:0"],
  events: [
    { id: "run-walk", title: "Run walk", notes: "Hot", entries: [
      { kind: "activity", activity: { id: "walk", exerciseId: "seed:0033", comment: "Easy", effort: "low", startedAt: "2026-10-02T06:24:07.000Z", sourceOffsetMinutes: 600, garminSourceKey: `${fit}:0`, result: { minutes: 5, calories: 21 } } },
      { kind: "activity", activity: { id: "run", exerciseId: "seed:0170", comment: "", startedAt: "2026-10-02T06:29:30.000Z", sourceOffsetMinutes: 600, garminSourceKey: `${fit}:1`, result: { minutes: 5, calories: 40 } } },
    ] },
    { id: "manual", title: null, notes: "", entries: [{ kind: "activity", activity: { id: "tennis", exerciseId: "seed:0171", comment: "", startedAt: "2026-10-02T08:00:00.000Z", result: { minutes: 60, calories: null } } }] },
    { id: "untimed", title: null, notes: "", entries: [{ kind: "activity", activity: { id: "yoga", exerciseId: "seed:0172", comment: "", result: { minutes: null, calories: null } } }] },
    { id: "gym", title: null, notes: "", entries: [{ kind: "session", session: {
      id: "strength", startedAt: "2026-10-02T07:00:00.000Z", endedAt: "2026-10-02T08:05:00.123Z", warmup: [], main: [], cooldown: [], calories: 300, notes: "", garminSourceKey: "garmin:9:2026-10-02T07:00:00.000Z:0",
    } }] },
  ],
};

const one = (id: string, exerciseId: string, startedAt: string, minutes: number | null = 5, calories: number | null = 20): Activity =>
  ({ id, comment: "", segments: [{ id, exerciseId, startedAt, result: { minutes, calories } }] });

function v9Day(): DayDoc {
  const day = emptyDay("2026-10-05");
  addEventEntry(day, { kind: "activity", activity: one("warm-up", "seed:0170", "2026-10-05T17:10:00+11:00") });
  addEventEntry(day, { kind: "session", session: { id: "warm-up", startedAt: "2026-10-05T17:30:00+11:00", endedAt: "2026-10-05T18:30:00+11:00", warmup: [], main: [], cooldown: [], calories: null, notes: "" } });
  day.garminLinks.push({ sourceKey: "garmin:5:2026-10-05T06:10:00.000Z:0", target: { kind: "segment", id: "warm-up" } });
  return day;
}

describe("DayDoc v9 conversion", () => {
  it("turns each v8 activity into a one-segment activity with offset times and day-level Garmin links", () => {
    const day = inputDaySchema.parse(v8);
    expect(day).toEqual({
      v: 9, date: "2026-10-02", comments: v8.comments, totalCalories: 900,
      events: [
        { id: "run-walk", title: "Run walk", notes: "Hot", entries: [
          { kind: "activity", activity: { id: "walk", comment: "Easy", effort: "low", segments: [{ id: "walk", exerciseId: "seed:0033", startedAt: "2026-10-02T16:24:07+10:00", result: { minutes: 5, calories: 21 } }] } },
          { kind: "activity", activity: { id: "run", comment: "", segments: [{ id: "run", exerciseId: "seed:0170", startedAt: "2026-10-02T16:29:30+10:00", result: { minutes: 5, calories: 40 } }] } },
        ] },
        { id: "manual", title: null, notes: "", entries: [{ kind: "activity", activity: { id: "tennis", comment: "", segments: [{ id: "tennis", exerciseId: "seed:0171", startedAt: "2026-10-02T18:00:00+10:00", result: { minutes: 60, calories: null } }] } }] },
        { id: "untimed", title: null, notes: "", entries: [{ kind: "activity", activity: { id: "yoga", comment: "", segments: [{ id: "yoga", exerciseId: "seed:0172", startedAt: "2026-10-02T12:00:00+10:00", result: { minutes: null, calories: null } }] } }] },
        { id: "gym", title: null, notes: "", entries: [{ kind: "session", session: {
          id: "strength", startedAt: "2026-10-02T17:00:00+10:00", endedAt: "2026-10-02T18:05:00+10:00", warmup: [], main: [], cooldown: [], calories: 300, notes: "",
        } }] },
      ],
      garminLinks: [
        { sourceKey: `${fit}:0`, target: { kind: "segment", id: "walk" } },
        { sourceKey: `${fit}:1`, target: { kind: "segment", id: "run" } },
        { sourceKey: "garmin:9:2026-10-02T07:00:00.000Z:0", target: { kind: "session", id: "strength" } },
        { sourceKey: "garmin:1:2026-10-02T01:00:00.000Z:0", target: null },
      ],
    });
    expect(daySchema.parse(day)).toEqual(day);
    expect(normalizeDay(day)).toBe(day);
  });

  it("uses the daylight-saving offset after 4 October and converts v7 through v8", () => {
    const { v: _v, ...rest } = structuredClone(v8);
    const v7 = { ...rest, v: 7 as const, date: "2026-10-05", ignoredGarminSourceKeys: [], events: [
      { id: "e", title: null, notes: "", entries: [{ kind: "activity" as const, activity: { id: "a", exerciseId: "seed:0170", comment: "", startedAt: "2026-10-05T06:10:00.000Z", result: { minutes: 20, calories: 150 } } }] },
    ] };
    const day = inputDaySchema.parse(v7);
    expect(day.v).toBe(9);
    expect(day.events[0].entries[0]).toMatchObject({ activity: { segments: [{ startedAt: "2026-10-05T17:10:00+11:00" }] } });
  });
});

describe("DayDoc v9 schema", () => {
  it("accepts session and activity IDs that repeat across namespaces", () => {
    const day = v9Day();
    expect(daySchema.parse(day)).toEqual(day);
  });

  it.each([
    ["a Z suffix", "2026-10-05T06:10:00Z"],
    ["a missing offset", "2026-10-05T17:10:00"],
    ["fractional seconds", "2026-10-05T17:10:00.000+11:00"],
  ])("rejects a time with %s", (_label, startedAt) => {
    const day = v9Day();
    const entry = day.events[0].entries[0];
    if (entry.kind !== "activity") throw new Error("expected activity");
    entry.activity.segments[0].startedAt = startedAt;
    expect(daySchema.safeParse(day).success).toBe(false);
    const session = v9Day();
    const part = session.events[1].entries[0];
    if (part.kind !== "session") throw new Error("expected session");
    part.session.endedAt = startedAt;
    expect(daySchema.safeParse(session).success).toBe(false);
  });

  it("rejects an activity without segments or with segments out of time order", () => {
    const empty = v9Day();
    const entry = empty.events[0].entries[0];
    if (entry.kind !== "activity") throw new Error("expected activity");
    entry.activity.segments = [];
    expect(daySchema.safeParse(empty).success).toBe(false);
    entry.activity.segments = [...one("b", "seed:0170", "2026-10-05T17:20:00+11:00").segments, ...one("warm-up", "seed:0033", "2026-10-05T06:15:00+00:00").segments];
    expect(daySchema.safeParse(empty).success).toBe(false);
    entry.activity.segments.reverse();
    expect(daySchema.safeParse(empty).success).toBe(true);
  });

  it.each([
    ["session IDs", (day: DayDoc) => addEventEntry(day, { kind: "session", session: { id: "warm-up", startedAt: "2026-10-05T19:00:00+11:00", endedAt: null, warmup: [], main: [], cooldown: [], calories: null, notes: "" } })],
    ["activity IDs", (day: DayDoc) => addEventEntry(day, { kind: "activity", activity: { ...one("other", "seed:0033", "2026-10-05T19:00:00+11:00"), id: "warm-up" } })],
    ["segment IDs", (day: DayDoc) => addEventEntry(day, { kind: "activity", activity: { ...one("warm-up", "seed:0033", "2026-10-05T19:00:00+11:00"), id: "other" } })],
    ["Garmin source keys", (day: DayDoc) => day.garminLinks.push({ sourceKey: day.garminLinks[0].sourceKey, target: null })],
    ["links to one segment", (day: DayDoc) => day.garminLinks.push({ sourceKey: "garmin:6:2026-10-05T06:10:00.000Z:0", target: { kind: "segment", id: "warm-up" } })],
  ])("rejects duplicate %s", (_label, change) => {
    const day = v9Day();
    change(day);
    expect(daySchema.safeParse(day).success).toBe(false);
  });

  it("rejects a link to a missing session or segment", () => {
    for (const target of [{ kind: "session" as const, id: "missing" }, { kind: "segment" as const, id: "missing" }]) {
      const day = v9Day();
      day.garminLinks.push({ sourceKey: "garmin:7:2026-10-05T06:10:00.000Z:0", target });
      expect(daySchema.safeParse(day).success).toBe(false);
    }
  });

  it("deletes a removed item's Garmin links with it", () => {
    const day = v9Day();
    day.garminLinks.push({ sourceKey: "garmin:8:2026-10-05T06:30:00.000Z:0", target: { kind: "session", id: "warm-up" } }, { sourceKey: "garmin:9:x:0", target: null });
    removeEventEntry(day, "activity", "warm-up");
    expect(day.garminLinks.map((link) => link.sourceKey)).toEqual(["garmin:8:2026-10-05T06:30:00.000Z:0", "garmin:9:x:0"]);
    removeEventEntry(day, "session", "warm-up");
    expect(day.garminLinks).toEqual([{ sourceKey: "garmin:9:x:0", target: null }]);
    expect(daySchema.parse(day)).toEqual(day);
  });
});

it("names an activity from its distinct exercises and totals its segments", () => {
  const activity: Activity = { id: "combined", comment: "", segments: [
    ...one("w1", "walk", "2026-10-02T16:24:07+10:00", 5, null).segments,
    ...one("r1", "run", "2026-10-02T16:29:30+10:00", 5, null).segments,
    ...one("w2", "walk", "2026-10-02T16:35:00+10:00", null, null).segments,
  ] };
  expect(activityName(activity, (id) => id === "walk" ? "Walk" : "Run")).toBe("Walk/Run");
  expect(activityName({ ...activity, segments: [activity.segments[0], activity.segments[2]] }, () => "Walk")).toBe("Walk");
  expect(activityTotals(activity)).toEqual({ minutes: 10, calories: null });
  expect(activityStart(activity)).toBe("2026-10-02T16:24:07+10:00");
});
