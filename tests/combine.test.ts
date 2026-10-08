import { expect, it } from "vitest";
import { addEventEntry, combineActivities, emptyDay, splitActivity, type Activity, type DayDoc } from "../shared/days/model";
import { daySchema } from "../shared/days/schema";
import type { Effort } from "../shared/exercises/model";

const name = (id: string) => id === "walk" ? "Walk" : "Run";
const part = (id: string, exerciseId: string, startedAt: string, comment = "", effort?: Effort): Activity =>
  ({ id, comment, ...(effort ? { effort } : {}), segments: [{ id, exerciseId, startedAt, result: { minutes: 5, calories: 20 } }] });

function runWalk(): DayDoc {
  const day = emptyDay("2026-10-02");
  const event = addEventEntry(day, { kind: "activity", activity: part("w1", "walk", "2026-10-02T16:24:07+10:00", "Easy", "low") });
  event.entries.push(
    { kind: "activity", activity: part("w2", "walk", "2026-10-02T16:34:00+10:00") },
    { kind: "activity", activity: part("r1", "run", "2026-10-02T06:29:30+00:00", "", "high") },
  );
  event.title = "Run walk";
  event.notes = "Hot";
  day.garminLinks = ["w1", "r1", "w2"].map((id, i) => ({ sourceKey: `garmin:1:2026-10-02T06:24:07.000Z:${i}`, target: { kind: "segment" as const, id } }));
  return day;
}

it("combines every activity part of an event into one activity with the highest effort", () => {
  const day = runWalk();
  const links = structuredClone(day.garminLinks);
  const activity = combineActivities(day, day.events[0].id);
  expect(["w1", "w2", "r1"]).not.toContain(activity.id);
  expect(day.events[0]).toEqual({ id: day.events[0].id, title: null, notes: "", entries: [{ kind: "activity", activity }] });
  expect(activity).toEqual({ id: activity.id, comment: "Run walk\nHot\nEasy", effort: "high", segments: [
    part("w1", "walk", "2026-10-02T16:24:07+10:00").segments[0],
    part("r1", "run", "2026-10-02T06:29:30+00:00").segments[0],
    part("w2", "walk", "2026-10-02T16:34:00+10:00").segments[0],
  ] });
  expect(day.garminLinks).toEqual(links);
  expect(daySchema.parse(day)).toEqual(day);
});

it("refuses to combine a single part, a session or an event with entered totals", () => {
  const single = emptyDay("2026-10-02");
  addEventEntry(single, { kind: "activity", activity: part("w1", "walk", "2026-10-02T16:24:07+10:00") });
  const withSession = runWalk();
  withSession.events[0].entries.push({ kind: "session", session: { id: "s", startedAt: "2026-10-02T17:00:00+10:00", endedAt: null, warmup: [], main: [], cooldown: [], calories: null, notes: "" } });
  const withTotals = runWalk();
  withTotals.events[0].summaryOverrides = { activeCalories: 433 };
  for (const day of [single, withSession, withTotals]) {
    const before = structuredClone(day);
    expect(() => combineActivities(day, day.events[0].id)).toThrow();
    expect(day).toEqual(before);
  }
});

it("splits a combined activity into one activity per segment and keeps its name and comment on the event", () => {
  const day = runWalk();
  const links = structuredClone(day.garminLinks);
  const combined = combineActivities(day, day.events[0].id);
  splitActivity(day, combined.id, name);
  expect(day.events).toEqual([{ id: day.events[0].id, title: "Walk/Run", notes: "Run walk\nHot\nEasy", entries: combined.segments.map((segment) => ({ kind: "activity", activity: { id: segment.id, comment: "", segments: [segment] } })) }]);
  expect(day.garminLinks).toEqual(links);
  expect(daySchema.parse(day)).toEqual(day);
  expect(() => splitActivity(day, "w1", name)).toThrow();
});

it("keeps a visit's own title and notes when splitting one of its parts", () => {
  const day = runWalk();
  const combined = combineActivities(day, day.events[0].id);
  combined.comment = "Intervals";
  day.events[0].title = "Park visit";
  day.events[0].notes = "With Sam";
  day.events[0].entries.push({ kind: "activity", activity: part("t1", "tennis", "2026-10-02T18:00:00+10:00") });
  splitActivity(day, combined.id, name);
  expect(day.events[0]).toMatchObject({ title: "Park visit", notes: "With Sam\nIntervals" });
  expect(day.events[0].entries.map((entry) => entry.kind === "activity" && entry.activity.id)).toEqual(["w1", "r1", "w2", "t1"]);
});
