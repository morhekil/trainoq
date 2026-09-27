// Mutations on a (cloned) DayDoc. All take the draft and mutate it in place.

import type { Block, Exercise, Section, SetType, WorkSet } from "../../../shared/exercises/model";
import type { DayDoc } from "../../../shared/days/model";
import type { Session } from "../../../shared/sessions/model";
import { suggestedSet } from "../exercises/library";
import { uid } from "../../id";

export function findSession(d: DayDoc, sid: string): Session {
  const s = d.sessions.find((x) => x.id === sid);
  if (!s) throw new Error("session not found");
  return s;
}
export function findBlock(s: Session, section: Section, bid: string): Block {
  const b = s[section].find((x) => x.id === bid);
  if (!b) throw new Error("block not found");
  return b;
}
export function findExercise(b: Block, eid: string): Exercise {
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

/**
 * A fresh set, pre-filled so you only correct it:
 * - another set of a type you've already done today -> copy the last one of that type
 * - first working / back-off set today -> what you did for that set type last time
 * - otherwise -> copy the previous set (or last time's first set, or blank)
 */
export function makeSet(ex: Exercise, date: string, section: Section, type?: SetType): WorkSet {
  const prev = ex.sets[ex.sets.length - 1];
  const t: SetType = type ?? prev?.type ?? suggestedSet(ex.name, date, section)?.type ?? "warmup";
  const from = (s: Pick<WorkSet, "weight" | "reps">): WorkSet => ({ id: uid(), type: t, weight: s.weight, reps: s.reps });
  const sameType = [...ex.sets].reverse().find((s) => s.type === t);
  if (sameType) return from(sameType);
  const hint = suggestedSet(ex.name, date, section, t, true);
  if (hint) return from(hint);
  if (prev) return from(prev);
  const first = suggestedSet(ex.name, date, section);
  if (first) return from(first);
  return { id: uid(), type: t, weight: null, reps: null };
}

export function newExercise(name: string, date: string, section: Section): Exercise {
  const ex: Exercise = { id: uid(), name, sets: [], comment: "" };
  ex.sets.push(makeSet(ex, date, section));
  return ex;
}

/** Every exercise in a superset has the same set types, so a new one copies them from the block. */
export function addToBlock(b: Block, name: string, date: string, section: Section): void {
  const [first] = b.exercises;
  if (!first) {
    b.exercises.push(newExercise(name, date, section));
    return;
  }
  const ex: Exercise = { id: uid(), name, sets: [], comment: "" };
  for (const s of first.sets) ex.sets.push(makeSet(ex, date, section, s.type));
  b.exercises.push(ex);
}

export function addRound(b: Block, date: string, section: Section, type: SetType): void {
  for (const ex of b.exercises) ex.sets.push(makeSet(ex, date, section, type));
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

/** Repeat names, grouping and set types without copying recorded values. */
export function copyBlocks(blocks: Block[]): Block[] {
  return blocks
    .map((b) => ({
      id: uid(),
      exercises: b.exercises.filter((e) => e.name.trim()).map((e): Exercise => ({
        id: uid(), name: e.name, comment: "",
        sets: e.sets.map((s) => ({ id: uid(), type: s.type, weight: null, reps: null })),
      })),
    }))
    .filter((b) => b.exercises.length);
}

export function blockLetter(i: number): string {
  return String.fromCharCode(65 + (i % 26));
}
