import { describe, expect, it } from "vitest";
import { copyItems, findItem, setLabels } from "../frontend/features/sessions/ops";
import type { SessionItem } from "../shared/exercises/model";
import { exerciseIdForName } from "../shared/exercises/catalog";

describe("session editing", () => {
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
});
