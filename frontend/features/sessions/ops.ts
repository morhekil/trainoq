import type { Section, SessionItem, SetType, StandaloneExercise, Superset, WorkSet } from "../../../shared/exercises/model";
import type { DayDoc } from "../../../shared/days/model";
import type { Session } from "../../../shared/sessions/model";
import { suggestedSet } from "../exercises/library";
import { uid } from "../../id";
export { move } from "../../../shared/sessions/ops";

export function findSession(d: DayDoc, sid: string): Session {
  const session = d.sessions.find((s) => s.id === sid);
  if (!session) throw new Error("Session not found");
  return session;
}
export function findItem(session: Session, section: Section, id: string): SessionItem {
  const item = session[section].find((i) => i.id === id);
  if (!item) throw new Error("Item not found");
  return item;
}
export function findSuperset(session: Session, section: Section, id: string): Superset {
  const item = findItem(session, section, id);
  if (item.kind !== "superset") throw new Error("Superset not found");
  return item;
}
export function findStandalone(session: Session, section: Section, id: string): StandaloneExercise {
  const item = findItem(session, section, id);
  if (item.kind !== "exercise") throw new Error("Standalone exercise not found");
  return item;
}

export function newSession(): Session {
  return { id: uid(), startedAt: new Date().toISOString(), endedAt: null, warmup: [], main: [], cooldown: [], calories: null, notes: "" };
}

export function makeSet(exercise: StandaloneExercise, date: string, section: Section, type?: SetType): WorkSet {
  const prev = exercise.sets.at(-1);
  const t: SetType = type ?? prev?.type ?? suggestedSet(exercise.exerciseId, date, section)?.type ?? "warmup";
  const from = (set: Pick<WorkSet, "weight" | "reps">): WorkSet => ({ id: uid(), type: t, weight: set.weight, reps: set.reps });
  const same = [...exercise.sets].reverse().find((set) => set.type === t);
  if (same) return from(same);
  const hint = suggestedSet(exercise.exerciseId, date, section, t, true);
  if (hint) return from(hint);
  if (prev) return from(prev);
  const first = suggestedSet(exercise.exerciseId, date, section);
  return first ? from(first) : { id: uid(), type: t, weight: null, reps: null };
}

export function newExercise(exerciseId: string, date: string, section: Section): StandaloneExercise {
  const exercise: StandaloneExercise = { kind: "exercise", id: uid(), exerciseId, sets: [], comment: "" };
  exercise.sets.push(makeSet(exercise, date, section));
  return exercise;
}

export function nextSetType(t: SetType): SetType {
  return t === "warmup" ? "working" : t === "working" ? "backoff" : "warmup";
}

export function setLabels(sets: Pick<WorkSet, "type">[]): string[] {
  const n: Record<SetType, number> = { warmup: 0, working: 0, backoff: 0 };
  return sets.map((set) => {
    n[set.type]++;
    return set.type === "warmup" ? `W${n.warmup}` : set.type === "backoff" ? `B${n.backoff}` : String(n.working);
  });
}

export function copyItems(items: SessionItem[]): SessionItem[] {
  return items.map((item) => item.kind === "exercise"
    ? { ...item, id: uid(), comment: "", sets: item.sets.map((set) => ({ id: uid(), type: set.type, weight: null, reps: null })) }
    : {
      kind: "superset" as const, id: uid(),
      members: item.members.map((member) => ({ ...member, id: uid(), comment: "" })),
      rounds: item.rounds.map((round) => ({ id: uid(), type: round.type })),
      results: [] as Superset["results"],
    }).map((item) => {
      if (item.kind === "superset") item.results = item.rounds.flatMap((round) => item.members.map((member) => ({ memberId: member.id, roundId: round.id, weight: null, reps: null })));
      return item;
    });
}

export function blockLetter(i: number): string { return String.fromCharCode(65 + (i % 26)); }
