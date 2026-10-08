import { describe, expect, it } from "vitest";
import { daySchema } from "../shared/days/schema";
import { addEventEntry, emptyDay, type DayDoc } from "../shared/days/model";
import { exerciseIdForName } from "../shared/exercises/catalog";
import { dayToText } from "../shared/days/format";
import { formatEffort } from "../shared/exercises/format";
import { createSuperset, dissolveSuperset } from "../shared/sessions/ops";
import { copyItems } from "../frontend/features/sessions/ops";
import { daySessions } from "../shared/days/model";
import { exerciseLibrary } from "../backend/features/exercises/db";

function effortDay(): DayDoc {
  const doc = emptyDay("2026-10-08");
  addEventEntry(doc, { kind: "session", session: {
    id: "s", startedAt: "2026-10-08T07:00:00.000Z", endedAt: "2026-10-08T08:00:00.000Z", calories: null, notes: "", warmup: [], cooldown: [],
    main: [
      { kind: "exercise", id: "squat", exerciseId: exerciseIdForName("Squat"), comment: "", effort: "high", params: { perSet: ["weight", "reps"] }, sets: [{ id: "1", type: "working", weight: 80, reps: 5 }] },
      { kind: "superset", id: "ss", members: [
        { id: "plank", exerciseId: exerciseIdForName("Plank"), comment: "", effort: "max", params: { perSet: ["time"] } },
        { id: "row", exerciseId: exerciseIdForName("Row"), comment: "", params: { perSet: ["weight", "reps"] } },
      ], rounds: [{ id: "r", type: "working" }], results: [{ memberId: "plank", roundId: "r", time: 60 }, { memberId: "row", roundId: "r", weight: 20, reps: 10 }] },
    ],
  } });
  addEventEntry(doc, { kind: "activity", activity: { id: "run", exerciseId: exerciseIdForName("Run"), comment: "", effort: "low", result: { minutes: 30, calories: 250 } } });
  return doc;
}

describe("effort", () => {
  it("is saved on exercise entries, superset members and activities", () => {
    const doc = effortDay();
    expect(daySchema.parse(doc)).toEqual(doc);
  });

  it("accepts only the four RPE levels", () => {
    const doc = effortDay();
    const activity = doc.events[1].entries[0];
    if (activity.kind !== "activity") throw new Error("expected activity");
    (activity.activity as { effort: string }).effort = "many";
    expect(daySchema.safeParse(doc).success).toBe(false);
  });

  it("reads as reps in reserve for rep-based records and RPE otherwise", () => {
    const reps = { perSet: ["weight" as const, "reps" as const] };
    expect(["low", "med", "high", "max"].map((effort) => formatEffort(effort as "low", reps))).toEqual(["RIR a lot", "RIR many", "RIR few", "RIR none"]);
    expect(formatEffort("high", { perSet: ["time"] })).toBe("RPE high");
    expect(formatEffort("med")).toBe("RPE med");
  });

  it("appears in shared day text after each record's values", () => {
    const names: Record<string, string> = { [exerciseIdForName("Squat")]: "Squat", [exerciseIdForName("Plank")]: "Plank", [exerciseIdForName("Row")]: "Row", [exerciseIdForName("Run")]: "Run" };
    const text = dayToText(effortDay(), "Australia/Sydney", (id) => names[id]);
    expect(text).toContain("Squat: 80kg×5 · RIR few");
    expect(text).toContain("- Plank: 60s · RPE max");
    expect(text).toContain("- Row: 20kg×10\n");
    expect(text).toContain("Run · 30 min · 250 cal · RPE low");
  });

  it("stays with an entry moved into and out of a superset", () => {
    const items = daySessions(effortDay())[0].main;
    const superset = createSuperset(items, "squat", "new");
    expect(superset.members[0].effort).toBe("high");
    dissolveSuperset(items, "new");
    expect(items[0]).toMatchObject({ kind: "exercise", id: "squat", effort: "high" });
  });

  it("is not copied when a section is repeated", () => {
    const copy = copyItems(daySessions(effortDay())[0].main);
    expect(copy[0]).not.toHaveProperty("effort");
    if (copy[1].kind !== "superset") throw new Error("expected superset");
    expect(copy[1].members[0]).not.toHaveProperty("effort");
  });

  it("comes back with exercise and activity history", async () => {
    const squat = exerciseIdForName("Squat");
    const run = exerciseIdForName("Run");
    const db = { prepare: () => ({ all: async () => ({ results: [] }) }), async batch() { return [
      { results: [] },
      { results: [
        { exercise_id: squat, name: "Squat", date: "2026-10-08", section: "main", detail: JSON.stringify({ params: { perSet: ["weight", "reps"] }, sets: [{ type: "working", weight: 80, reps: 5 }], effort: "high" }) },
        { exercise_id: run, name: "Run", date: "2026-10-08", section: "activity", detail: JSON.stringify({ minutes: 30, calories: 250, effort: "low" }) },
        { exercise_id: run, name: "Run", date: "2026-10-07", section: "activity", detail: JSON.stringify({ minutes: 20, calories: null }) },
      ] },
    ]; } } as unknown as D1Database;
    const lib = await exerciseLibrary(db);
    expect(lib.history[squat][0]).toMatchObject({ effort: "high" });
    expect(lib.history[run]).toEqual([
      { date: "2026-10-08", section: "activity", result: { minutes: 30, calories: 250 }, effort: "low" },
      { date: "2026-10-07", section: "activity", result: { minutes: 20, calories: null } },
    ]);
  });
});
