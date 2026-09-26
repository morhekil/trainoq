// Mutations on a (cloned) DayDoc. All take the draft and mutate it in place.

import type { Block, MainExercise, SetType, SimpleItem, WorkSet } from "../../../shared/exercises/model";
import type { DayDoc } from "../../../shared/days/model";
import type { Session } from "../../../shared/sessions/model";
import { suggestedSet } from "../exercises/library";
import { uid } from "../../id";

export type SimpleSection = "warmup" | "cooldown";

export function findSession(d: DayDoc, sid: string): Session {
  const s = d.sessions.find((x) => x.id === sid);
  if (!s) throw new Error("session not found");
  return s;
}
export function findBlock(s: Session, bid: string): Block {
  const b = s.main.find((x) => x.id === bid);
  if (!b) throw new Error("block not found");
  return b;
}
export function findExercise(b: Block, eid: string): MainExercise {
  const e = b.exercises.find((x) => x.id === eid);
  if (!e) throw new Error("exercise not found");
  return e;
}

export function move<T>(arr: T[], index: number, delta: number): void {
  const j = index + delta;
  if (j < 0 || j >= arr.length) return;
  const [x] = arr.splice(index, 1);
  arr.splice(j, 0, x);
}

export function newSession(): Session {
  return { id: uid(), startedAt: new Date().toISOString(), endedAt: null, warmup: [], main: [], cooldown: [], calories: null, notes: "" };
}

export function newSimple(name: string, reps = ""): SimpleItem {
  return { id: uid(), name, reps, comment: "" };
}

/**
 * A fresh set, pre-filled so you only correct it:
 * - another set of a type you've already done today -> copy the last one of that type
 * - first working / back-off set today -> what you did for that set type last time
 * - otherwise -> copy the previous set (or last time's first set, or blank)
 */
export function makeSet(ex: MainExercise, date: string, type?: SetType): WorkSet {
  const prev = ex.sets[ex.sets.length - 1];
  const t: SetType = type ?? prev?.type ?? suggestedSet(ex.name, date)?.type ?? "warmup";
  const from = (s: Pick<WorkSet, "weight" | "reps">): WorkSet => ({ id: uid(), type: t, weight: s.weight, reps: s.reps });
  const sameType = [...ex.sets].reverse().find((s) => s.type === t);
  if (sameType) return from(sameType);
  const hint = suggestedSet(ex.name, date, t, true);
  if (hint) return from(hint);
  if (prev) return from(prev);
  const first = suggestedSet(ex.name, date);
  if (first) return from(first);
  return { id: uid(), type: t, weight: null, reps: null };
}

export function newExercise(name: string, date: string): MainExercise {
  const ex: MainExercise = { id: uid(), name, sets: [], comment: "" };
  ex.sets.push(makeSet(ex, date));
  return ex;
}

/** Every exercise in a superset has the same set types, so a new one copies them from the block. */
export function addToBlock(b: Block, name: string, date: string): void {
  const [first] = b.exercises;
  if (!first) {
    b.exercises.push(newExercise(name, date));
    return;
  }
  const ex: MainExercise = { id: uid(), name, sets: [], comment: "" };
  for (const s of first.sets) ex.sets.push(makeSet(ex, date, s.type));
  b.exercises.push(ex);
}

export function addRound(b: Block, date: string, type: SetType): void {
  for (const ex of b.exercises) ex.sets.push(makeSet(ex, date, type));
}

export function setRoundType(b: Block, index: number, type: SetType): void {
  for (const ex of b.exercises) if (ex.sets[index]) ex.sets[index].type = type;
}

export function removeRound(b: Block, index: number): void {
  for (const ex of b.exercises) ex.sets.splice(index, 1);
}

export function nextSetType(t: SetType): SetType {
  return t === "warmup" ? "working" : t === "working" ? "backoff" : "warmup";
}

/** Labels like W1 W2 1 2 3 B1 */
export function setLabels(sets: WorkSet[]): string[] {
  const n: Record<SetType, number> = { warmup: 0, working: 0, backoff: 0 };
  return sets.map((s) => {
    n[s.type]++;
    return s.type === "warmup" ? `W${n.warmup}` : s.type === "backoff" ? `B${n.backoff}` : String(n.working);
  });
}

/** Copy a section from an earlier session: names and reps, but not comments or sets. */
export function copySimple(items: SimpleItem[]): SimpleItem[] {
  return items.filter((i) => i.name.trim()).map((i) => newSimple(i.name, i.reps));
}

/** Structure only – no sets, so nothing is logged until you actually add a set. */
export function copyMain(blocks: Block[]): Block[] {
  return blocks
    .map((b) => ({
      id: uid(),
      exercises: b.exercises.filter((e) => e.name.trim()).map((e): MainExercise => ({ id: uid(), name: e.name, sets: [], comment: "" })),
    }))
    .filter((b) => b.exercises.length);
}

export function blockLetter(i: number): string {
  return String.fromCharCode(65 + (i % 26));
}
