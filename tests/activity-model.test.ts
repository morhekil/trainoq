import { describe, expect, it } from "vitest";
import { daySummary, dayToText } from "../shared/days/format";
import { exerciseIdForName, SEED_EXERCISES } from "../shared/exercises/catalog";
import { inputDaySchema, daySchema } from "../shared/days/schema";
import { legacyExerciseNames } from "../shared/days/migrate";
import type { V3DayDoc } from "../shared/days/migrate";
import { searchExercises } from "../frontend/features/exercises/library";

describe("catalog-backed activities", () => {
  it("migrates v3 names and notes into exercise performances without losing results", () => {
    const old: V3DayDoc = {
      v: 3, date: "2026-09-28", morning: "", sessions: [], totalCalories: 140, notes: "",
      activities: [
        { id: "walk", name: "Walk", minutes: 30, calories: 120, notes: "Hills" },
        { id: "custom", name: "Trail run", minutes: null, calories: 20, notes: "Easy" },
        { id: "blank", name: "", minutes: 5, calories: null, notes: "Unknown activity" },
      ],
    };

    const migrated = inputDaySchema.parse(old);
    expect(migrated).toMatchObject({ v: 6, activities: [
      { id: "walk", exerciseId: exerciseIdForName("Walk"), comment: "Hills", result: { minutes: 30, calories: 120 } },
      { id: "custom", exerciseId: exerciseIdForName("Trail run"), comment: "Easy", result: { minutes: null, calories: 20 } },
      { id: "blank", exerciseId: exerciseIdForName("Activity"), comment: "Unknown activity", result: { minutes: 5, calories: null } },
    ] });
    expect(legacyExerciseNames(old)).toContain("Trail run");
    expect(daySchema.parse(migrated)).toEqual(migrated);
    expect(daySchema.safeParse(old).success).toBe(false);
    expect(dayToText(migrated)).toContain("- Walk · 30 min · 120 cal – Hills");
    expect(daySummary(migrated)).toContain("Walk");
  });

  it("offers activity exercises through the regular library search", () => {
    for (const name of ["Run", "Walk", "Tennis", "Yoga", "Skipping"])
      expect(SEED_EXERCISES.some((exercise) => exercise.name === name)).toBe(true);
    const suggestions = searchExercises("", "activity").flatMap((group) => group.items.map((item) => item.name));
    expect(suggestions).toContain("Run");
    expect(suggestions).toContain("Tennis");
    expect(searchExercises("yoga", "activity")[0].items[0].name).toBe("Yoga");
  });
});
