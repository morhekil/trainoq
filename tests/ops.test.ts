import { describe, expect, it } from "vitest";
import { copyItems, findItem, newExercise, nextRoundType, setLabels } from "../frontend/features/sessions/ops";
import type { SessionItem } from "../shared/exercises/model";
import { exerciseIdForName } from "../shared/exercises/catalog";
import { finishAtClock } from "../shared/sessions/ops";

describe("session editing", () => {
  it("anchors an edited finish clock to the first occurrence after the start", () => {
    const start = "2026-10-12T20:51:00+11:00";
    const tapped = "2026-10-13T00:03:00+11:00";
    expect(finishAtClock(start, tapped, "21:20")).toBe("2026-10-12T21:20:00+11:00");
    expect(finishAtClock(start, tapped, "00:20")).toBe("2026-10-13T00:20:00+11:00");
  });

  it("repeats identity, grouping and round types without recorded values", () => {
    const items: SessionItem[] = [
      { kind: "exercise", id: "e", exerciseId: exerciseIdForName("Squat"), comment: "depth", params: { perSet: ["weight", "reps"] }, sets: [{ id: "set", type: "working", weight: 40, reps: 5 }] },
      { kind: "superset", id: "ss", members: [
        { id: "a", exerciseId: exerciseIdForName("Row"), comment: "steady", params: { perSet: ["weight", "reps"] } },
        { id: "b", exerciseId: exerciseIdForName("Press"), comment: "", params: { perSet: ["weight", "reps"] } },
      ], rounds: [{ id: "r1", type: "warmup" }, { id: "r2", type: "working" }], results: [
        { memberId: "a", roundId: "r1", weight: 0, reps: 10 }, { memberId: "b", roundId: "r1", weight: 5, reps: 8 },
        { memberId: "a", roundId: "r2", weight: 20, reps: 6 }, { memberId: "b", roundId: "r2", weight: 10, reps: 6 },
      ] },
      { kind: "superset", id: "empty", members: [], rounds: [{ id: "held", type: "backoff" }], results: [] },
    ];
    const copy = copyItems(items);
    expect(copy.map((item) => item.kind)).toEqual(["exercise", "superset", "superset"]);
    expect(copy[0]).toMatchObject({ kind: "exercise", exerciseId: exerciseIdForName("Squat"), comment: "", sets: [{ type: "working", weight: null, reps: null }] });
    expect(copy[1]).toMatchObject({ kind: "superset", members: [{ comment: "" }, { comment: "" }], rounds: [{ type: "warmup" }, { type: "working" }] });
    if (copy[1].kind !== "superset") throw new Error("expected superset");
    expect(copy[1].results).toHaveLength(4);
    expect(copy[1].results.every((result) => result.weight === null && result.reps === null)).toBe(true);
    expect(copy[2]).toMatchObject({ kind: "superset", members: [], rounds: [{ type: "backoff" }], results: [] });
    expect(copy[1].id).not.toBe(items[1].id);
    expect(copy[1].rounds[0].id).not.toBe("r1");
  });

  it("finds an item in the requested section and labels types", () => {
    const session = { id: "s", startedAt: "", endedAt: null, warmup: [{ kind: "exercise" as const, id: "e", exerciseId: "seed:squat", comment: "", params: { perSet: ["weight" as const, "reps" as const] }, sets: [] }], main: [], cooldown: [], calories: null, notes: "" };
    expect(findItem(session, "warmup", "e")).toBe(session.warmup[0]);
    expect(() => findItem(session, "main", "e")).toThrow();
    expect(setLabels([{ type: "warmup" }, { type: "working" }, { type: "working" }, { type: "backoff" }])).toEqual(["W1", "1", "2", "B1"]);
  });

  it("starts a first set or round on its section's usual type", () => {
    const empty = { kind: "superset" as const, id: "ss", members: [], rounds: [], results: [] };
    expect((["warmup", "main", "cooldown"] as const).map((section) => [newExercise("seed:0029", "2026-10-05", section).sets[0].type, nextRoundType(empty, section)]))
      .toEqual([["warmup", "warmup"], ["working", "working"], ["backoff", "backoff"]]);
    expect(nextRoundType({ ...empty, rounds: [{ id: "r1", type: "warmup" }] }, "main")).toBe("warmup");
  });
});
