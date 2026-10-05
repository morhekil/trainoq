import { describe, expect, it } from "vitest";
import { normalizeDay } from "../shared/days/migrate";
import { daySchema } from "../shared/days/schema";
import { addEventEntry, emptyDay, mergeEvents } from "../shared/days/model";

describe("training events", () => {
  it("wraps v6 records as stable singleton events without changing their contents", () => {
    const session = { id: "session-1", startedAt: "2026-10-02T06:00:00.000Z", endedAt: "2026-10-02T06:30:00.000Z", calories: 90, notes: "Keep these notes", warmup: [], main: [], cooldown: [] };
    const activity = { id: "activity-1", exerciseId: "seed:0170", comment: "Edited", startedAt: "2026-10-02T07:00:00.000Z", garminSourceKey: "garmin:serial:2026-10-02T07:00:00.000Z:0", result: { minutes: 12, calories: 50 } };
    const old = { v: 6 as const, date: "2026-10-02", comments: [{ id: "comment-1", time: "07:05", text: "Still here" }], sessions: [session], activities: [activity], ignoredGarminSourceKeys: [], totalCalories: 220 };

    const migrated = normalizeDay(old);

    expect(migrated).toEqual({ v: 7, date: old.date, comments: old.comments, events: [
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
