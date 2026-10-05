import { expect, it } from "vitest";
import { addEventEntry, dayActivities, daySessions, emptyDay } from "../shared/days/model";
import type { GarminActivitySummary } from "../shared/garmin/fit";
import type { Session } from "../shared/sessions/model";
import { acceptActivity, ignoreGarmin, linkStrengthSession, moveLinkedActivity, strengthMatches, unlinkGarmin } from "../shared/garmin/decisions";

const source: GarminActivitySummary = { sourceKey: "garmin:1:2026-09-28T05:00:00.000Z:0", sport: "training", subSport: "strengthTraining", title: "Strength", startUtc: "2026-09-28T06:00:00.000Z", localDate: "2026-09-28", offsetMinutes: 600, timerSeconds: 3600, elapsedSeconds: 3700, activeCalories: 362 };
const session = (id: string, start: string): Session => ({ id, startedAt: start, endedAt: "2026-09-28T07:00:00.000Z", warmup: [], main: [], cooldown: [], calories: null, notes: "sets stay here" });

it("suggests only one close completed strength session and preserves training details on link", () => {
  const doc = emptyDay("2026-09-28");
  addEventEntry(doc, { kind: "session", session: session("near", "2026-09-28T05:45:00.000Z") });
  addEventEntry(doc, { kind: "session", session: session("far", "2026-09-28T01:00:00.000Z") });
  expect(strengthMatches(doc, source)).toEqual(["near"]);
  addEventEntry(doc, { kind: "session", session: session("also-near", "2026-09-28T06:20:00.000Z") });
  expect(strengthMatches(doc, source)).toEqual(["near", "also-near"]);
  doc.events.pop();
  linkStrengthSession(doc, source, "near");
  expect(daySessions(doc)[0]).toMatchObject({ id: "near", notes: "sets stay here", calories: 362, garminSourceKey: source.sourceKey });
  unlinkGarmin(doc, source.sourceKey);
  expect(daySessions(doc)[0]).toMatchObject({ id: "near", calories: 362 });
  expect(daySessions(doc)[0].garminSourceKey).toBeUndefined();
});

it("accepts activity values once, keeps corrections through re-import, and can ignore and restore", () => {
  const doc = emptyDay("2026-09-28");
  const activity = acceptActivity(doc, { ...source, sport: "running", title: "Run" }, "seed:0170");
  expect(activity).toMatchObject({ garminSourceKey: source.sourceKey, startedAt: source.startUtc, sourceOffsetMinutes: 600, result: { minutes: 60, calories: 362 } });
  activity.result.calories = 350;
  expect(() => acceptActivity(doc, { ...source, activeCalories: 400 }, "seed:0170")).toThrow();
  expect(activity.result.calories).toBe(350);
  unlinkGarmin(doc, source.sourceKey);
  expect(activity.garminSourceKey).toBeUndefined();
  ignoreGarmin(doc, source.sourceKey);
  expect(doc.ignoredGarminSourceKeys).toEqual([source.sourceKey]);
  unlinkGarmin(doc, source.sourceKey);
  expect(doc.ignoredGarminSourceKeys).toEqual([]);
  expect(dayActivities(doc)).toHaveLength(1);
});

it("moves an accepted activity to another day without replacing corrected values or its local time", () => {
  const oldDay = emptyDay("2026-09-28");
  const activity = acceptActivity(oldDay, source, "seed:0170");
  activity.comment = "Corrected name and notes";
  activity.result.calories = 350;
  const newDay = emptyDay("2026-09-29");
  moveLinkedActivity(oldDay, newDay, source.sourceKey);
  expect(dayActivities(oldDay)).toEqual([]);
  expect(dayActivities(newDay)).toMatchObject([{ id: activity.id, comment: "Corrected name and notes", garminSourceKey: source.sourceKey, sourceOffsetMinutes: 600, startedAt: "2026-09-29T06:00:00.000Z", result: { minutes: 60, calories: 350 } }]);
});
