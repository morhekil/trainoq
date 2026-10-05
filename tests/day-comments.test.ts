import { describe, expect, it } from "vitest";
import { inputDaySchema } from "../shared/days/schema";
import { isDayEmpty } from "../shared/days/model";

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
