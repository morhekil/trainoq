import { describe, expect, it } from "vitest";
import { normalizeDay } from "../shared/days/migrate";
import { daySchema } from "../shared/days/schema";
import { addEventEntry, detachEventEntry, emptyDay, mergeEvents } from "../shared/days/model";
import { eventMeasurements } from "../shared/days/summary";

describe("training events", () => {
  it("wraps v6 records as stable singleton events without changing their contents", () => {
    const session = { id: "session-1", startedAt: "2026-10-02T06:00:00.000Z", endedAt: "2026-10-02T06:30:00.000Z", calories: 90, notes: "Keep these notes", warmup: [], main: [], cooldown: [] };
    const activity = { id: "activity-1", exerciseId: "seed:0170", comment: "Edited", startedAt: "2026-10-02T07:00:00.000Z", garminSourceKey: "garmin:serial:2026-10-02T07:00:00.000Z:0", result: { minutes: 12, calories: 50 } };
    const old = { v: 6 as const, date: "2026-10-02", comments: [{ id: "comment-1", time: "07:05", text: "Still here" }], sessions: [session], activities: [activity], ignoredGarminSourceKeys: [], totalCalories: 220 };

    const migrated = normalizeDay(old);

    expect(migrated).toEqual({ v: 8, date: old.date, comments: old.comments, events: [
      { id: "migrated:session:session-1", title: null, notes: "", entries: [{ kind: "session", session }] },
      { id: "migrated:activity:activity-1", title: null, notes: "", entries: [{ kind: "activity", activity }] },
    ], ignoredGarminSourceKeys: [], totalCalories: 220 });
    expect(daySchema.parse(migrated)).toEqual(migrated);
  });
});

it("combines existing entries into one ordered event without changing their IDs or Garmin links", () => {
  const day = emptyDay("2026-10-02");
  const run = { id: "run", exerciseId: "seed:0170", comment: "Edited", startedAt: "2026-10-02T06:30:00.000Z", garminSourceKey: "garmin:fit:1", result: { minutes: 5, calories: 40 } };
  const walk = { id: "walk", exerciseId: "seed:0033", comment: "", startedAt: "2026-10-02T06:24:00.000Z", garminSourceKey: "garmin:fit:0", result: { minutes: 5, calories: 20 } };
  const first = addEventEntry(day, { kind: "activity", activity: run });
  const second = addEventEntry(day, { kind: "activity", activity: walk });

  mergeEvents(day, [first.id, second.id]);

  expect(day.events).toEqual([{ id: first.id, title: null, notes: "", entries: [
    { kind: "activity", activity: walk }, { kind: "activity", activity: run },
  ] }]);
  expect(daySchema.parse(day)).toEqual(day);
});

it("leaves event metadata and entries intact when a merge would discard them", () => {
  const day = emptyDay("2026-10-05");
  const activity = (id: string) => ({ id, exerciseId: "seed:0033", comment: "", result: { minutes: 10, calories: 20 } });
  const first = addEventEntry(day, { kind: "activity", activity: activity("walk") });
  const second = addEventEntry(day, { kind: "activity", activity: activity("run") });
  second.notes = "Keep this event note";
  const before = structuredClone(day);

  expect(() => mergeEvents(day, [first.id, second.id])).toThrow(/notes and totals/);
  expect(day).toEqual(before);
});

it("separates a part without losing its data or the original event note", () => {
  const day = emptyDay("2026-10-05");
  const walk = { id: "walk", exerciseId: "seed:0033", comment: "Original wording", result: { minutes: 10, calories: 20 } };
  const run = { id: "run", exerciseId: "seed:0170", comment: "", result: { minutes: 10, calories: 30 } };
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
  const event = addEventEntry(day, { kind: "activity", activity: { id: "walk", exerciseId: "seed:0033", startedAt: "2026-10-02T06:00:00.000Z", garminSourceKey: `${fit}:0`, comment: "", result: { minutes: 5, calories: 20 } } });
  event.entries.push({ kind: "activity", activity: { id: "run", exerciseId: "seed:0170", startedAt: "2026-10-02T06:06:00.000Z", garminSourceKey: `${fit}:1`, comment: "", result: { minutes: 7, calories: 25 } } });
  const source = (index: number, startUtc: string, timerSeconds: number, elapsedSeconds: number, activeCalories: number) => ({ sourceKey: `${fit}:${index}`, sport: "running", subSport: null, title: "Run", startUtc, localDate: "2026-10-02", offsetMinutes: 600, timerSeconds, elapsedSeconds, activeCalories });
  const sources = new Map([
    [`${fit}:0`, source(0, "2026-10-02T06:00:00.000Z", 318, 340, 28)],
    [`${fit}:1`, source(1, "2026-10-02T06:06:00.000Z", 402, 440, 37)],
  ]);
  expect(eventMeasurements(event, sources)).toEqual({ savedMinutes: 12, timerSeconds: 720, elapsedSeconds: 800, activeCalories: 65, sourceComplete: true });
  event.summaryOverrides = { timerSeconds: null, activeCalories: 70 };
  expect(eventMeasurements(event, sources)).toEqual({ savedMinutes: 12, timerSeconds: null, elapsedSeconds: 800, activeCalories: 70, sourceComplete: true });
  event.entries.push({ kind: "session", session: { id: "strength", startedAt: "2026-10-02T06:07:00.000Z", endedAt: null, warmup: [], main: [], cooldown: [], calories: 40, notes: "" } });
  event.summaryOverrides = undefined;
  expect(eventMeasurements(event, sources)).toEqual({ savedMinutes: null, timerSeconds: null, elapsedSeconds: null, activeCalories: null, sourceComplete: false });
});
