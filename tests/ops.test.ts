import { describe, expect, it } from "vitest";
import type { Block, SetType, WorkSet } from "../shared/exercises/model";
import { addToBlock, copyBlocks, findBlock, removeRound, setRoundType } from "../frontend/features/sessions/ops";
import { emptyDay } from "../shared/days/model";

const DATE = "2026-09-23";
const set = (type: SetType, weight: number | null, reps: number | null): WorkSet => ({ id: crypto.randomUUID(), type, weight, reps });
const types = (b: Block) => b.exercises.map((e) => e.sets.map((s) => s.type));

describe("superset sets stay in sync", () => {
  it("finds blocks in the requested section and repeats their set types without values", () => {
    const session = {
      id: "session", startedAt: "2026-09-23T07:00:00Z", endedAt: null,
      warmup: [{ id: "warm", exercises: [{ id: "a", name: "Row", comment: "note", sets: [set("working", 12, 10), set("backoff", 8, 12)] }, { id: "b", name: "Press", comment: "", sets: [set("working", 5, 8), set("backoff", 3, 12)] }] }],
      main: [], cooldown: [], calories: null, notes: "",
    };
    const doc = emptyDay(DATE);
    doc.sessions.push(session);
    expect(findBlock(session, "warmup", "warm")).toBe(session.warmup[0]);
    expect(() => findBlock(session, "main", "warm")).toThrow("block not found");
    const copied = copyBlocks(session.warmup);
    expect(copied).toHaveLength(1);
    expect(copied[0].exercises.map((e) => ({ name: e.name, comment: e.comment, sets: e.sets.map(({ type, weight, reps }) => ({ type, weight, reps })) }))).toEqual([
      { name: "Row", comment: "", sets: [{ type: "working", weight: null, reps: null }, { type: "backoff", weight: null, reps: null }] },
      { name: "Press", comment: "", sets: [{ type: "working", weight: null, reps: null }, { type: "backoff", weight: null, reps: null }] },
    ]);
    expect(copied[0].exercises[0].sets[0].id).not.toBe(session.warmup[0].exercises[0].sets[0].id);
  });
  it("a new exercise in a superset gets the same set types as the others", () => {
    const b: Block = {
      id: "b",
      exercises: [
        {
          id: "e1",
          name: "Push-up",
          comment: "",
          sets: [set("warmup", 0, 5), set("warmup", 0, 8), set("working", 10, 10), set("working", 10, 10), set("working", 10, 10), set("backoff", 0, 12)],
        },
      ],
    };
    addToBlock(b, "Pull-up", DATE, "main");
    addToBlock(b, "Dumbbell press", DATE, "main");
    expect(types(b)).toEqual([
      ["warmup", "warmup", "working", "working", "working", "backoff"],
      ["warmup", "warmup", "working", "working", "working", "backoff"],
      ["warmup", "warmup", "working", "working", "working", "backoff"],
    ]);
    // weights belong to each exercise: nothing is carried over from push-ups
    expect(b.exercises[1].sets.every((s) => s.weight == null && s.reps == null)).toBe(true);
  });

  it("the first exercise of a new block starts with one set", () => {
    const b: Block = { id: "b", exercises: [] };
    addToBlock(b, "Pull-up", DATE, "main");
    expect(b.exercises.map((e) => [e.name, e.sets.length])).toEqual([["Pull-up", 1]]);
  });

  it("changing a set's type changes that round in every exercise", () => {
    const b: Block = {
      id: "b",
      exercises: [
        { id: "e1", name: "Push-up", comment: "", sets: [set("warmup", 0, 5), set("warmup", 0, 8)] },
        { id: "e2", name: "Pull-up", comment: "", sets: [set("warmup", 0, 3), set("warmup", 0, 5)] },
      ],
    };
    setRoundType(b, 1, "working");
    expect(types(b)).toEqual([
      ["warmup", "working"],
      ["warmup", "working"],
    ]);
  });

  it("deleting a set deletes that round from every exercise", () => {
    const b: Block = {
      id: "b",
      exercises: [
        { id: "e1", name: "Push-up", comment: "", sets: [set("warmup", 0, 5), set("working", 10, 10), set("backoff", 0, 12)] },
        { id: "e2", name: "Pull-up", comment: "", sets: [set("warmup", 0, 3), set("working", 5, 6), set("backoff", 0, 8)] },
      ],
    };
    removeRound(b, 1);
    expect(b.exercises.map((e) => e.sets.map((s) => [s.type, s.weight, s.reps]))).toEqual([
      [
        ["warmup", 0, 5],
        ["backoff", 0, 12],
      ],
      [
        ["warmup", 0, 3],
        ["backoff", 0, 8],
      ],
    ]);
  });
});
