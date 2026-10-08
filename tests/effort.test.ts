import { describe, expect, it } from "vitest";
import { daySchema } from "../shared/days/schema";
import { addEventEntry, emptyDay, type DayDoc } from "../shared/days/model";
import { exerciseIdForName } from "../shared/exercises/catalog";

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
});
