import { expect, it } from "vitest";
import { addEventEntry, dayActivities, daySessions, emptyDay } from "../shared/days/model";
import type { GarminActivitySummary } from "../shared/garmin/fit";
import type { Session } from "../shared/sessions/model";
import { acceptActivity, ignoreGarmin, linkStrengthSession, moveLinkedActivity, strengthMatches, unlinkGarmin } from "../shared/garmin/decisions";
import { daySchema } from "../shared/days/schema";

const source: GarminActivitySummary = { sourceKey: "garmin:1:2026-09-28T05:00:00.000Z:0", sport: "training", subSport: "strengthTraining", title: "Strength", startUtc: "2026-09-28T06:00:00.000Z", localDate: "2026-09-28", offsetMinutes: 600, timerSeconds: 3600, elapsedSeconds: 3700, activeCalories: 362 };
const session = (id: string, start: string): Session => ({ id, startedAt: start, endedAt: "2026-09-28T17:00:00+10:00", warmup: [], main: [], cooldown: [], calories: null, notes: "sets stay here" });

it("suggests only one close completed strength session and preserves training details on link", () => {
  const doc = emptyDay("2026-09-28");
  addEventEntry(doc, { kind: "session", session: session("near", "2026-09-28T15:45:00+10:00") });
  addEventEntry(doc, { kind: "session", session: session("far", "2026-09-28T11:00:00+10:00") });
  expect(strengthMatches(doc, source)).toEqual(["near"]);
  addEventEntry(doc, { kind: "session", session: session("also-near", "2026-09-28T16:20:00+10:00") });
  expect(strengthMatches(doc, source)).toEqual(["near", "also-near"]);
  doc.events.pop();
  linkStrengthSession(doc, source, "near");
  expect(daySessions(doc)[0]).toMatchObject({ id: "near", notes: "sets stay here", calories: 362 });
  expect(doc.garminLinks).toEqual([{ sourceKey: source.sourceKey, target: { kind: "session", id: "near" } }]);
  expect(strengthMatches(doc, { ...source, sourceKey: "garmin:2:2026-09-28T05:00:00.000Z:0" })).toEqual([]);
  unlinkGarmin(doc, source.sourceKey);
  expect(daySessions(doc)[0]).toMatchObject({ id: "near", calories: 362 });
  expect(doc.garminLinks).toEqual([]);
});

it("accepts activity values once, keeps corrections through re-import, and can ignore and restore", () => {
  const doc = emptyDay("2026-09-28");
  const activity = acceptActivity(doc, { ...source, sport: "running", title: "Run" }, "seed:0170");
  expect(activity).toEqual({ id: activity.id, comment: "", segments: [{ id: activity.id, exerciseId: "seed:0170", startedAt: "2026-09-28T16:00:00+10:00", result: { minutes: 60, calories: 362 } }] });
  expect(doc.garminLinks).toEqual([{ sourceKey: source.sourceKey, target: { kind: "segment", id: activity.id } }]);
  expect(daySchema.parse(doc)).toEqual(doc);
  activity.segments[0].result.calories = 350;
  expect(() => acceptActivity(doc, { ...source, activeCalories: 400 }, "seed:0170")).toThrow();
  expect(activity.segments[0].result.calories).toBe(350);
  unlinkGarmin(doc, source.sourceKey);
  expect(doc.garminLinks).toEqual([]);
  ignoreGarmin(doc, source.sourceKey);
  expect(doc.garminLinks).toEqual([{ sourceKey: source.sourceKey, target: null }]);
  unlinkGarmin(doc, source.sourceKey);
  expect(doc.garminLinks).toEqual([]);
  expect(dayActivities(doc)).toHaveLength(1);
});

it("moves an accepted activity to another day without replacing corrected values or its local time", () => {
  const oldDay = emptyDay("2026-09-28");
  const activity = acceptActivity(oldDay, source, "seed:0170");
  activity.comment = "Corrected name and notes";
  activity.segments[0].result.calories = 350;
  const newDay = emptyDay("2026-09-29");
  moveLinkedActivity(oldDay, newDay, source.sourceKey);
  expect(dayActivities(oldDay)).toEqual([]);
  expect(oldDay.garminLinks).toEqual([]);
  expect(dayActivities(newDay)).toEqual([{ id: activity.id, comment: "Corrected name and notes", segments: [{ id: activity.id, exerciseId: "seed:0170", startedAt: "2026-09-29T16:00:00+10:00", result: { minutes: 60, calories: 350 } }] }]);
  expect(newDay.garminLinks).toEqual([{ sourceKey: source.sourceKey, target: { kind: "segment", id: activity.id } }]);
  expect(daySchema.parse(newDay)).toEqual(newDay);
});
