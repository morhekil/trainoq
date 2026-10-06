import { describe, expect, it } from "vitest";
import { dayToText, daySummary } from "../shared/days/format";
import { formatSets } from "../shared/exercises/format";
import type { DayDoc } from "../shared/days/model";
import type { WorkSet } from "../shared/exercises/model";
import { exerciseIdForName } from "../shared/exercises/catalog";

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
      v: 7,
      date: "2026-09-22",
      ignoredGarminSourceKeys: [],
      comments: [{ id: "c", time: "08:00", text: "Morning stiffness: 4/10" }],
      events: [{ id: "session-event", title: null, notes: "", entries: [{ kind: "session", session: {
          id: "s",
          startedAt: "2026-09-22T07:00:00.000Z",
          endedAt: "2026-09-22T08:10:00.000Z",
          warmup: [{ kind: "exercise", id: "wa", exerciseId: exerciseIdForName("Side plank"), sets: [{ id: "w1", ...set("working", null, null) }], comment: "30s" }],
          main: [
            { kind: "superset", id: "b", members: [
              { id: "e1", exerciseId: exerciseIdForName("Pull-up"), comment: "" },
              { id: "e2", exerciseId: exerciseIdForName("Bench press"), comment: "easy" },
            ], rounds: [{ id: "r", type: "working" }], results: [
              { memberId: "e1", roundId: "r", weight: 10, reps: 5 },
              { memberId: "e2", roundId: "r", weight: 40, reps: 6 },
            ] },
          ],
          cooldown: [{ kind: "exercise", id: "ce", exerciseId: exerciseIdForName("Jefferson curl"), sets: [{ id: "c1", ...set("working", 4, 4) }], comment: "4kg" }],
          calories: 317,
          notes: "",
        } }] }, { id: "walk-event", title: null, notes: "", entries: [{ kind: "activity", activity: { id: "w", exerciseId: exerciseIdForName("Walk"), comment: "", result: { minutes: 30, calories: 115 } } }] }],
      totalCalories: 710,
    };
    expect(dayToText(doc, "Australia/Sydney")).toBe(
      [
        "Tue 22 Sep 2026",
        "",
        "Comment 08:00",
        "Morning stiffness: 4/10",
        "",
        "----",
        "Session 5:00pm–6:10pm (70 min) · 317 active cal",
        "",
        "Warm-up",
        "Side plank",
        "  – 30s",
        "",
        "Main",
        "Superset: Pull-up / Bench press",
        "- Pull-up: 10kg×5",
        "- Bench press: 40kg×6",
        "  – easy",
        "",
        "Cool-down",
        "Jefferson curl: 4kg×4",
        "  – 4kg",
        "",
        "----",
        "Activities",
        "- Walk · 30 min · 115 cal",
        "",
        "----",
        "Total daily active calories: 710",
      ].join("\n"),
    );
    expect(daySummary(doc, "Australia/Sydney")).toContain("4 exercises");
  });

  it("shares a grouped event as one named visit with every original part and note", () => {
    const doc: DayDoc = {
      v: 7, date: "2026-10-02", comments: [{ id: "c", time: "17:05", text: "Between parts" }], ignoredGarminSourceKeys: [], totalCalories: 430,
      events: [{ id: "visit", title: "Walk-run", notes: "Intervals with hills", entries: [
        { kind: "activity", activity: { id: "walk", exerciseId: "walk", startedAt: "2026-10-02T06:00:00.000Z", comment: "Easy", result: { minutes: 5, calories: 30 } } },
        { kind: "activity", activity: { id: "run", exerciseId: "run", startedAt: "2026-10-02T06:10:00.000Z", comment: "", result: { minutes: 5, calories: 40 } } },
      ] }],
    };
    const shared = dayToText(doc, "Australia/Sydney", (id) => id === "walk" ? "Walk" : "Run");
    expect(shared).toContain("Walk-run (2 parts)\nIntervals with hills\n- 16:00 Walk · 5 min · 30 cal – Easy\n- 16:10 Run · 5 min · 40 cal");
    expect(shared.indexOf("Between parts")).toBeGreaterThan(shared.indexOf("Run · 5 min"));
    expect(shared).toContain("Total daily active calories: 430");
    expect(daySummary(doc, "Australia/Sydney", (id) => id === "walk" ? "Walk" : "Run")).toBe("Walk-run (2 parts) · 430 cal total");
  });
});
