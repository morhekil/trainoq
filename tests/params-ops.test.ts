import { expect, it } from "vitest";
import { addRound, createSuperset, dissolveSuperset, removedValues, setRecordParams } from "../shared/sessions/ops";
import type { SessionItem } from "../shared/exercises/model";
import { itemSets, sessionLines } from "../shared/sessions/format";
import { newExercise } from "../frontend/features/sessions/ops";

it("keeps each parameter while moving a performance through a superset", () => {
  const items: SessionItem[] = [{ kind: "exercise", id: "e", exerciseId: "seed:0079", comment: "", params: { perSet: ["edge", "time", "reps"] }, sets: [
    { id: "s", type: "working", edge: 20, time: 15, reps: 3 },
  ] }];
  const superset = createSuperset(items, "e", "ss");
  addRound(superset, "r2", "working");
  expect(superset.results[1]).toMatchObject({ edge: 20, time: 15, reps: 3 });
  dissolveSuperset(items, "ss");
  expect(items[0]).toMatchObject({ kind: "exercise", params: { perSet: ["edge", "time", "reps"] }, sets: [
    { edge: 20, time: 15, reps: 3 }, { edge: 20, time: 15, reps: 3 },
  ] });
});

it("reports removed values and keeps shared values when parameters change", () => {
  const item: SessionItem = { kind: "exercise", id: "e", exerciseId: "seed:0121", comment: "", params: { perSet: ["weight", "reps"] }, sets: [
    { id: "s1", type: "working", weight: 0, reps: 5 },
    { id: "s2", type: "working", weight: null, reps: 6 },
  ] };
  const next = { perSet: ["height", "reps"] as ("height" | "reps")[] };
  expect(removedValues(item, "e", next)).toEqual([{ param: "weight", count: 1 }]);
  setRecordParams(item, "e", next);
  expect(item).toMatchObject({ params: next, sets: [
    { height: null, reps: 5 }, { height: null, reps: 6 },
  ] });
  if (item.kind !== "exercise") throw new Error("Expected exercise");
  expect(item.sets[0]).not.toHaveProperty("weight");
});

it("shares the values owned by each superset member", () => {
  const item: SessionItem = { kind: "superset", id: "ss", members: [
    { id: "m", exerciseId: "seed:0079", comment: "", params: { perSet: ["edge", "time", "reps"] } },
  ], rounds: [{ id: "r", type: "warmup" }], results: [{ memberId: "m", roundId: "r", edge: 20, time: 15, reps: 3 }] };
  expect(itemSets(item, "m")[0]).toMatchObject({ edge: 20, time: 15, reps: 3 });
  const lines = sessionLines({ id: "s", startedAt: "2026-10-05T07:00:00.000Z", endedAt: null, calories: null, notes: "", warmup: [], main: [item], cooldown: [] });
  expect(lines.join("\n")).toContain("Hangboard: warm-up 20mm 15s×3");
});

it("starts a built-in hold with its time field and no unrelated values", () => {
  const exercise = newExercise("seed:0029", "2026-10-05", "main");
  expect(exercise.params).toEqual({ perSet: ["time"] });
  expect(exercise.sets[0]).toMatchObject({ time: null });
  expect(exercise.sets[0]).not.toHaveProperty("weight");
});
