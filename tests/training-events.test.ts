import { describe, expect, it } from "vitest";
import { normalizeDay } from "../shared/days/migrate";
import { daySchema } from "../shared/days/schema";
import { addEventEntry, detachEventEntry, emptyDay, mergeEvents, type Activity } from "../shared/days/model";
import { activityMeasurements, eventMeasurements } from "../shared/days/summary";

const activity = (id: string, exerciseId: string, startedAt: string, minutes: number | null, calories: number | null, comment = ""): Activity =>
  ({ id, comment, segments: [{ id, exerciseId, startedAt, result: { minutes, calories } }] });

describe("training events", () => {
  it("wraps v6 records as stable singleton events without changing their contents", () => {
    const session = { id: "session-1", startedAt: "2026-10-02T06:00:00.000Z", endedAt: "2026-10-02T06:30:00.000Z", calories: 90, notes: "Keep these notes", warmup: [], main: [], cooldown: [] };
    const old = { v: 6 as const, date: "2026-10-02", comments: [{ id: "comment-1", time: "07:05", text: "Still here" }], sessions: [session],
      activities: [{ id: "activity-1", exerciseId: "seed:0170", comment: "Edited", startedAt: "2026-10-02T07:00:00.000Z", garminSourceKey: "garmin:serial:2026-10-02T07:00:00.000Z:0", result: { minutes: 12, calories: 50 } }],
      ignoredGarminSourceKeys: [], totalCalories: 220 };

    const migrated = normalizeDay(old);

    expect(migrated).toEqual({ v: 9, date: old.date, comments: old.comments, events: [
      { id: "migrated:session:session-1", title: null, notes: "", entries: [{ kind: "session", session: { ...session, startedAt: "2026-10-02T16:00:00+10:00", endedAt: "2026-10-02T16:30:00+10:00" } }] },
      { id: "migrated:activity:activity-1", title: null, notes: "", entries: [{ kind: "activity", activity: activity("activity-1", "seed:0170", "2026-10-02T17:00:00+10:00", 12, 50, "Edited") }] },
    ], garminLinks: [{ sourceKey: "garmin:serial:2026-10-02T07:00:00.000Z:0", target: { kind: "segment", id: "activity-1" } }], totalCalories: 220 });
    expect(daySchema.parse(migrated)).toEqual(migrated);
  });
});

it("combines existing entries into one ordered event without changing their IDs or Garmin links", () => {
  const day = emptyDay("2026-10-02");
  const run = activity("run", "seed:0170", "2026-10-02T16:30:00+10:00", 5, 40, "Edited");
  const walk = activity("walk", "seed:0033", "2026-10-02T06:24:00+00:00", 5, 20);
  const first = addEventEntry(day, { kind: "activity", activity: run });
  const second = addEventEntry(day, { kind: "activity", activity: walk });
  day.garminLinks = [{ sourceKey: "garmin:fit:1", target: { kind: "segment", id: "run" } }, { sourceKey: "garmin:fit:0", target: { kind: "segment", id: "walk" } }];
  const links = structuredClone(day.garminLinks);

  mergeEvents(day, [first.id, second.id]);

  expect(day.events).toEqual([{ id: first.id, title: null, notes: "", entries: [
    { kind: "activity", activity: walk }, { kind: "activity", activity: run },
  ] }]);
  expect(day.garminLinks).toEqual(links);
  expect(daySchema.parse(day)).toEqual(day);
});

it("leaves event metadata and entries intact when a merge would discard them", () => {
  const day = emptyDay("2026-10-05");
  const first = addEventEntry(day, { kind: "activity", activity: activity("walk", "seed:0033", "2026-10-05T17:00:00+11:00", 10, 20) });
  const second = addEventEntry(day, { kind: "activity", activity: activity("run", "seed:0033", "2026-10-05T17:10:00+11:00", 10, 20) });
  second.notes = "Keep this event note";
  const before = structuredClone(day);

  expect(() => mergeEvents(day, [first.id, second.id])).toThrow(/notes and totals/);
  expect(day).toEqual(before);
});

it("separates a part without losing its data or the original event note", () => {
  const day = emptyDay("2026-10-05");
  const walk = activity("walk", "seed:0033", "2026-10-05T17:00:00+11:00", 10, 20, "Original wording");
  const run = activity("run", "seed:0170", "2026-10-05T17:10:00+11:00", 10, 30);
  const event = addEventEntry(day, { kind: "activity", activity: walk });
  event.entries.push({ kind: "activity", activity: run });
  event.notes = "Visit note";

  detachEventEntry(day, event.id, "activity", walk.id);

  expect(day.events[0]).toMatchObject({ id: event.id, notes: "Visit note", entries: [{ activity: run }] });
  expect(day.events[1]).toMatchObject({ title: null, notes: "", entries: [{ activity: walk }] });
  expect(daySchema.parse(day)).toEqual(day);
});

it("labels saved rounded minutes separately from one FIT recording's source timer and elapsed span", () => {
  const day = emptyDay("2026-10-02");
  const fit = "garmin:123:2026-10-02T06:00:00.000Z";
  const event = addEventEntry(day, { kind: "activity", activity: activity("walk", "seed:0033", "2026-10-02T16:00:00+10:00", 5, 20) });
  event.entries.push({ kind: "activity", activity: activity("run", "seed:0170", "2026-10-02T16:06:00+10:00", 7, 25) });
  day.garminLinks = [{ sourceKey: `${fit}:0`, target: { kind: "segment", id: "walk" } }, { sourceKey: `${fit}:1`, target: { kind: "segment", id: "run" } }];
  const source = (index: number, startUtc: string, timerSeconds: number, elapsedSeconds: number, activeCalories: number) => ({ sourceKey: `${fit}:${index}`, sport: "running", subSport: null, title: "Run", startUtc, localDate: "2026-10-02", offsetMinutes: 600, timerSeconds, elapsedSeconds, activeCalories });
  const sources = new Map([
    [`${fit}:0`, source(0, "2026-10-02T06:00:00.000Z", 318, 340, 28)],
    [`${fit}:1`, source(1, "2026-10-02T06:06:00.000Z", 402, 440, 37)],
  ]);
  expect(eventMeasurements(day, event, sources)).toEqual({ savedMinutes: 12, timerSeconds: 720, elapsedSeconds: 800, activeCalories: 65, sourceComplete: true });
  event.summaryOverrides = { timerSeconds: null, activeCalories: 70 };
  expect(eventMeasurements(day, event, sources)).toEqual({ savedMinutes: 12, timerSeconds: null, elapsedSeconds: 800, activeCalories: 70, sourceComplete: true });
  event.entries.push({ kind: "session", session: { id: "strength", startedAt: "2026-10-02T16:07:00+10:00", endedAt: null, warmup: [], main: [], cooldown: [], calories: 40, notes: "" } });
  event.summaryOverrides = undefined;
  expect(eventMeasurements(day, event, sources)).toEqual({ savedMinutes: null, timerSeconds: null, elapsedSeconds: null, activeCalories: null, sourceComplete: false });
});

it("measures a combined activity's linked segments the same way as an event of separate parts", () => {
  const day = emptyDay("2026-10-02");
  const fit = "garmin:123:2026-10-02T06:00:00.000Z";
  const combined: Activity = { id: "combined", comment: "", segments: [...activity("walk", "seed:0033", "2026-10-02T16:00:00+10:00", 5, 20).segments, ...activity("run", "seed:0170", "2026-10-02T16:06:00+10:00", 7, 25).segments] };
  addEventEntry(day, { kind: "activity", activity: combined });
  day.garminLinks = [{ sourceKey: `${fit}:0`, target: { kind: "segment", id: "walk" } }, { sourceKey: `${fit}:1`, target: { kind: "segment", id: "run" } }];
  const source = (index: number, startUtc: string, timerSeconds: number, elapsedSeconds: number, activeCalories: number) => ({ sourceKey: `${fit}:${index}`, sport: "running", subSport: null, title: "Run", startUtc, localDate: "2026-10-02", offsetMinutes: 600, timerSeconds, elapsedSeconds, activeCalories });
  const sources = new Map([[`${fit}:0`, source(0, "2026-10-02T06:00:00.000Z", 318, 340, 28)], [`${fit}:1`, source(1, "2026-10-02T06:06:00.000Z", 402, 440, 37)]]);
  expect(activityMeasurements(day, combined, sources)).toEqual({ savedMinutes: 12, timerSeconds: 720, elapsedSeconds: 800, activeCalories: 65, sourceComplete: true });
  day.garminLinks.pop();
  expect(activityMeasurements(day, combined, sources)).toMatchObject({ timerSeconds: null, sourceComplete: false });
});
