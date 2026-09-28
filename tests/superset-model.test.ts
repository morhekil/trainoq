import { describe, expect, it } from "vitest";
import { daySchema, inputDaySchema } from "../shared/days/schema";
import { emptyDay } from "../shared/days/model";
import { exerciseIdForName } from "../shared/exercises/catalog";
import type { SessionItem, Superset, WorkSet } from "../shared/exercises/model";
import { addMember, addRound, createSuperset, dissolveSuperset, joinPerformance, moveMember, reorderRound, removeMember, removeRound, setRoundType } from "../shared/sessions/ops";

const exercise = (id: string, name: string, sets: WorkSet[] = [{ id: `${id}-set`, type: "working", weight: 0, reps: 8 }]) =>
  ({ kind: "exercise" as const, id, exerciseId: exerciseIdForName(name), comment: `${name} note`, sets });

describe("session items", () => {
  it("migrates v2 values and comments without inferring a one-member superset", () => {
    const old = { ...emptyDay("2026-09-28"), v: 2, sessions: [{
      id: "s", startedAt: "2026-09-28T01:00:00Z", endedAt: null, calories: null, notes: "",
      warmup: [], cooldown: [], main: [{ id: "b1", exercises: [
        { id: "a", name: "Squat", comment: "depth", sets: [{ id: "a1", type: "warmup", weight: 0, reps: 5 }, { id: "a2", type: "working", weight: 40, reps: 8 }] },
        { id: "b", name: "Row", comment: "slow", sets: [{ id: "b1", type: "warmup", weight: null, reps: 5 }, { id: "b2", type: "working", weight: 20, reps: 8 }] },
      ] }, { id: "b2", exercises: [{ id: "c", name: "Press", comment: "pause", sets: [] }] }],
    }] };
    const migrated = inputDaySchema.parse(old);
    expect(migrated.v).toBe(4);
    expect(migrated.sessions[0].main).toEqual([
      { kind: "superset", id: "b1", members: [
        { id: "a", exerciseId: exerciseIdForName("Squat"), comment: "depth" },
        { id: "b", exerciseId: exerciseIdForName("Row"), comment: "slow" },
      ], rounds: [{ id: "a1", type: "warmup" }, { id: "a2", type: "working" }], results: [
        { memberId: "a", roundId: "a1", weight: 0, reps: 5 },
        { memberId: "b", roundId: "a1", weight: null, reps: 5 },
        { memberId: "a", roundId: "a2", weight: 40, reps: 8 },
        { memberId: "b", roundId: "a2", weight: 20, reps: 8 },
      ] },
      { kind: "exercise", id: "c", exerciseId: exerciseIdForName("Press"), comment: "pause", sets: [] },
    ]);
  });

  it("validates exactly one result per member-round pair", () => {
    const doc = emptyDay("2026-09-28");
    const item: Superset = { kind: "superset", id: "ss", members: [{ id: "a", exerciseId: exerciseIdForName("Squat"), comment: "" }], rounds: [{ id: "r", type: "working" }], results: [{ memberId: "a", roundId: "r", weight: 0, reps: 8 }] };
    doc.sessions.push({ id: "s", startedAt: "2026-09-28T01:00:00Z", endedAt: null, warmup: [], main: [item], cooldown: [], calories: null, notes: "" });
    expect(daySchema.parse(doc)).toEqual(doc);
    expect(daySchema.safeParse({ ...doc, sessions: [{ ...doc.sessions[0], main: [{ ...item, results: [] }] }] }).success).toBe(false);
    expect(daySchema.safeParse({ ...doc, sessions: [{ ...doc.sessions[0], main: [{ ...item, results: [...item.results, ...item.results] }] }] }).success).toBe(false);
    expect(daySchema.safeParse({ ...doc, sessions: [{ ...doc.sessions[0], main: [{ ...item, rounds: [...item.rounds, ...item.rounds] }] }] }).success).toBe(false);
  });

  it("copies each member's last round values when adding a round", () => {
    const ss: Superset = {
      kind: "superset", id: "ss",
      members: [
        { id: "a", exerciseId: exerciseIdForName("Squat"), comment: "" },
        { id: "b", exerciseId: exerciseIdForName("Row"), comment: "" },
      ],
      rounds: [{ id: "r1", type: "warmup" }, { id: "r2", type: "working" }],
      results: [
        { memberId: "a", roundId: "r1", weight: 20, reps: 12 },
        { memberId: "b", roundId: "r1", weight: 15, reps: 12 },
        { memberId: "a", roundId: "r2", weight: 40, reps: 8 },
        { memberId: "b", roundId: "r2", weight: 0, reps: null },
      ],
    };
    addRound(ss, "r3", "working");
    expect(ss.results.filter((result) => result.roundId === "r3")).toEqual([
      { memberId: "a", roundId: "r3", weight: 40, reps: 8 },
      { memberId: "b", roundId: "r3", weight: 0, reps: null },
    ]);
  });

  it("keeps superset identity with zero or one member, and preserves values across edits", () => {
    const items: SessionItem[] = [exercise("a", "Squat"), exercise("b", "Row", [{ id: "b-set", type: "working", weight: 20, reps: 9 }])];
    const ss = createSuperset(items, "a", "ss");
    expect(ss.kind).toBe("superset");
    expect(ss.members).toHaveLength(1);
    joinPerformance(items, "b", ss.id);
    expect(ss.results).toContainEqual({ memberId: "b", roundId: ss.rounds[0].id, weight: 20, reps: 9 });
    addRound(ss, "r2", "backoff");
    ss.results.find((r) => r.memberId === "a" && r.roundId === "r2")!.weight = 40;
    setRoundType(ss, "r2", "warmup");
    reorderRound(ss, "r2", 0);
    moveMember(ss, "b", 0);
    expect(ss.rounds.map((r) => r.id)).toEqual(["r2", "a-set"]);
    expect(ss.results.find((r) => r.memberId === "a" && r.roundId === "r2")?.weight).toBe(40);
    removeRound(ss, "a-set");
    removeMember(ss, "b");
    removeMember(ss, "a");
    expect(ss).toMatchObject({ kind: "superset", members: [], rounds: [{ id: "r2", type: "warmup" }], results: [] });
    addMember(ss, { id: "c", exerciseId: exerciseIdForName("Press"), comment: "" });
    expect(ss.results).toEqual([{ memberId: "c", roundId: "r2", weight: null, reps: null }]);
  });

  it("requires explicit alignment for mismatched sets and dissolves without losing values", () => {
    const items: SessionItem[] = [exercise("a", "Squat"), exercise("b", "Row", [{ id: "b-set", type: "backoff", weight: 20, reps: 9 }])];
    const ss = createSuperset(items, "a", "ss");
    expect(() => joinPerformance(items, "b", ss.id)).toThrow(/align/i);
    expect(items).toHaveLength(2);
    joinPerformance(items, "b", ss.id, "append");
    expect(ss.rounds.map((r) => r.type)).toEqual(["working", "backoff"]);
    expect(ss.results.find((r) => r.memberId === "b" && r.roundId === "b-set")).toMatchObject({ weight: 20, reps: 9 });
    dissolveSuperset(items, ss.id);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: "exercise", id: "a", comment: "Squat note", sets: [{ type: "working", weight: 0, reps: 8 }, { type: "backoff", weight: null, reps: null }] });
    expect(items[1]).toMatchObject({ kind: "exercise", id: "b", comment: "Row note", sets: [{ type: "working", weight: null, reps: null }, { type: "backoff", weight: 20, reps: 9 }] });
  });
});
