import { afterEach, expect, it, vi } from "vitest";
import { addEventEntry, dayActivities, daySessions, emptyDay } from "../shared/days/model";
import type { GarminActivitySummary } from "../shared/garmin/fit";
import type { Session } from "../shared/sessions/model";
import { acceptActivity, autoImport, ignoreGarmin, linkStrengthSession, moveLinkedActivity, strengthMatches, unlinkGarmin } from "../shared/garmin/decisions";
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

it("links a strength recording to a session left running and takes the recording's start and finish", () => {
  const doc = emptyDay("2026-09-28");
  addEventEntry(doc, { kind: "session", session: { ...session("open", "2026-09-28T15:40:00+10:00"), endedAt: null } });
  addEventEntry(doc, { kind: "session", session: session("finished-late", "2026-09-28T16:30:00+10:00") });
  expect(strengthMatches(doc, source)).toEqual(["open", "finished-late"]);
  linkStrengthSession(doc, source, "open");
  expect(daySessions(doc)[0]).toMatchObject({ startedAt: "2026-09-28T16:00:00+10:00", endedAt: "2026-09-28T17:01:40+10:00", calories: 362 });
  linkStrengthSession(doc, { ...source, sourceKey: "garmin:2:2026-09-28T05:00:00.000Z:0", elapsedSeconds: null }, "finished-late");
  expect(daySessions(doc)[1]).toMatchObject({ startedAt: "2026-09-28T16:00:00+10:00", endedAt: "2026-09-28T17:00:00+10:00" });
  expect(daySchema.parse(doc)).toEqual(doc);
});

it("auto-imports a day's pending recordings as review would and leaves unmatched strength pending", () => {
  const doc = emptyDay("2026-09-28");
  addEventEntry(doc, { kind: "session", session: { ...session("open", "2026-09-28T15:50:00+10:00"), endedAt: null } });
  const other = (key: string, title: string, startUtc: string) => ({ ...source, sourceKey: key, sport: title.toLowerCase(), subSport: null, title, startUtc });
  const walkStart = other("garmin:7:2026-09-28T01:00:00.000Z:0", "Walk", "2026-09-28T01:00:00.000Z");
  const walkEnd = other("garmin:7:2026-09-28T01:00:00.000Z:1", "Walk", "2026-09-28T01:20:00.000Z");
  const run = other("garmin:8:2026-09-28T08:00:00.000Z:0", "Run", "2026-09-28T08:00:00.000Z");
  const ignored = other("garmin:9:2026-09-28T09:00:00.000Z:0", "Ride", "2026-09-28T09:00:00.000Z");
  const secondStrength = { ...source, sourceKey: "garmin:10:2026-09-28T05:00:00.000Z:0" };
  ignoreGarmin(doc, ignored.sourceKey);
  const decided = autoImport(doc, [source, walkStart, walkEnd, run, ignored, secondStrength], (title) => `id:${title}`);
  expect(decided).toEqual([source.sourceKey, walkStart.sourceKey, walkEnd.sourceKey, run.sourceKey]);
  expect(daySessions(doc)[0]).toMatchObject({ id: "open", endedAt: "2026-09-28T17:01:40+10:00" });
  expect(doc.events.map((event) => event.entries.length)).toEqual([1, 2, 1]);
  expect(dayActivities(doc).map((activity) => activity.segments[0].exerciseId)).toEqual(["id:Walk", "id:Walk", "id:Run"]);
  expect(doc.garminLinks.map((link) => link.sourceKey)).not.toContain(secondStrength.sourceKey);
  expect(daySchema.parse(doc)).toEqual(doc);
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

afterEach(() => { vi.unstubAllEnvs(); });

it("uses the device offset for a recording whose FIT has no offset", () => {
  vi.stubEnv("TZ", "America/New_York");
  const doc = emptyDay("2026-09-28");
  const activity = acceptActivity(doc, { ...source, offsetMinutes: null, localDate: null }, "seed:0170");
  expect(activity.segments[0].startedAt).toBe("2026-09-28T02:00:00-04:00");
});

it("refuses to move one segment of a combined activity", () => {
  const day = emptyDay("2026-10-02");
  const segment = (id: string, startedAt: string) => ({ id, exerciseId: "seed:0033", startedAt, result: { minutes: 5, calories: 20 } });
  addEventEntry(day, { kind: "activity", activity: { id: "combined", comment: "", segments: [segment("walk", "2026-10-02T16:24:07+10:00"), segment("run", "2026-10-02T16:29:30+10:00")] } });
  day.garminLinks.push({ sourceKey: source.sourceKey, target: { kind: "segment", id: "run" } });
  const before = structuredClone(day);
  const target = emptyDay("2026-10-03");
  expect(() => moveLinkedActivity(day, target, source.sourceKey)).toThrow("Split the combined activity first");
  expect(day).toEqual(before);
  expect(target).toEqual(emptyDay("2026-10-03"));
});
