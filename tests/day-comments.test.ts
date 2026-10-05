import { describe, expect, it } from "vitest";
import { inputDaySchema } from "../shared/days/schema";
import { isDayEmpty } from "../shared/days/model";
import { emptyDay } from "../shared/days/model";
import { dayToText } from "../shared/days/format";

describe("day comments", () => {
  it("converts the two v5 check-ins to timed comments and keeps a comment-only day", () => {
    const old = {
      v: 5 as const,
      date: "2026-09-23",
      morning: "Out of bed\nAfter breakfast",
      notes: "At night",
      sessions: [],
      activities: [],
      ignoredGarminSourceKeys: [],
      totalCalories: null,
    };

    const day = inputDaySchema.parse(old);
    expect(day).toEqual({
      v: 6,
      date: old.date,
      comments: [
        { id: "migrated:morning:2026-09-23:0", time: "08:00", text: old.morning },
        { id: "migrated:notes:2026-09-23:0", time: "23:30", text: old.notes },
      ],
      sessions: [],
      activities: [],
      ignoredGarminSourceKeys: [],
      totalCalories: null,
    });
    expect(isDayEmpty(day)).toBe(false);
  });
});

it("shares comments, sessions and activities in timeline order", () => {
  const day = emptyDay("2026-09-23");
  day.comments = [
    { id: "late", time: "23:30", text: "Night reflection" },
    { id: "early", time: "08:00", text: "Morning reflection" },
  ];
  day.sessions = [{ id: "s", startedAt: "2026-09-23T02:00:00.000Z", endedAt: null, warmup: [], main: [], cooldown: [], calories: null, notes: "" }];
  day.activities = [
    { id: "walk", exerciseId: "seed:0033", comment: "", startedAt: "2026-09-23T06:00:00.000Z", sourceOffsetMinutes: 600, result: { minutes: 20, calories: null } },
    { id: "tennis", exerciseId: "seed:0171", comment: "", result: { minutes: 30, calories: null } },
  ];

  const summary = dayToText(day, "Australia/Sydney", (id) => id === "seed:0033" ? "Walk" : "Tennis");
  const positions = ["Morning reflection", "Session 12:00pm", "Walk", "Night reflection", "Tennis"].map((value) => summary.indexOf(value));
  expect(positions.every((position) => position >= 0)).toBe(true);
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
});
