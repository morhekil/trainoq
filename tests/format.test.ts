import { describe, expect, it } from "vitest";
import { dayToText } from "../shared/days/format";
import { formatSets } from "../shared/exercises/format";
import type { DayDoc } from "../shared/days/model";
import type { WorkSet } from "../shared/exercises/model";

const set = (type: WorkSet["type"], weight: number | null, reps: number | null) => ({ type, weight, reps });

describe("formatSets", () => {
  it("groups by phase and collapses identical sets", () => {
    expect(
      formatSets([set("warmup", 0, 6), set("warmup", 5, 5), set("working", 10, 5), set("working", 10, 5), set("working", 10, 5), set("backoff", 0, 9)]),
    ).toBe("warm-up BW×6, 5kg×5 | working 10kg×5 ×3 | back-off BW×9");
  });
  it("omits the phase label when everything is working sets", () => {
    expect(formatSets([set("working", 40, 6), set("working", 42.5, 5)])).toBe("40kg×6, 42.5kg×5");
  });
  it("skips empty sets and handles missing weight", () => {
    expect(formatSets([set("working", null, 8), set("working", null, null)])).toBe("×8");
  });
});

describe("dayToText", () => {
  it("renders a day the way it gets shared", () => {
    const doc: DayDoc = {
      v: 1,
      date: "2026-09-22",
      morning: "Morning stiffness: 4/10",
      sessions: [
        {
          id: "s",
          startedAt: "2026-09-22T07:00:00.000Z",
          endedAt: "2026-09-22T08:10:00.000Z",
          warmup: [{ id: "a", name: "Side plank", reps: "30s", comment: "" }],
          main: [
            {
              id: "b",
              exercises: [
                { id: "e1", name: "Pull-up", sets: [{ id: "1", ...set("working", 10, 5) }], comment: "" },
                { id: "e2", name: "Bench press", sets: [{ id: "2", ...set("working", 40, 6) }], comment: "easy" },
              ],
            },
          ],
          cooldown: [{ id: "c", name: "Jefferson curl", reps: "4", comment: "4kg" }],
          calories: 317,
          notes: "",
        },
      ],
      activities: [{ id: "w", name: "Walk", minutes: 30, calories: 115, notes: "" }],
      totalCalories: 710,
      notes: "",
    };
    expect(dayToText(doc, "Australia/Sydney")).toBe(
      [
        "Tue 22 Sep 2026",
        "",
        "Morning",
        "Morning stiffness: 4/10",
        "",
        "----",
        "Session 5:00pm–6:10pm (70 min) · 317 active cal",
        "",
        "Warm-up",
        "- Side plank 30s",
        "",
        "Main",
        "Superset: Pull-up / Bench press",
        "- Pull-up: 10kg×5",
        "- Bench press: 40kg×6",
        "  – easy",
        "",
        "Cool-down",
        "- Jefferson curl ×4 – 4kg",
        "",
        "----",
        "Activities",
        "- Walk · 30 min · 115 cal",
        "",
        "----",
        "Total daily active calories: 710",
      ].join("\n"),
    );
  });
});
