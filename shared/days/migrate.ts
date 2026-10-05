import { exerciseIdForName } from "../exercises/catalog";
import type { SessionItem, WorkSet } from "../exercises/model";
import type { Activity, DayDoc } from "./model";
import type { Session } from "../sessions/model";

export interface LegacyExercise { id: string; name: string; sets: WorkSet[]; comment: string }
export interface LegacyBlock { id: string; exercises: LegacyExercise[] }
export interface LegacyItem { id: string; name: string; reps: string; comment: string }
export interface LegacyActivity { id: string; name: string; minutes: number | null; calories: number | null; notes: string }
export type V6DayDoc = Omit<DayDoc, "v" | "events"> & { v: 6; sessions: Session[]; activities: Activity[] };
export type V5DayDoc = Omit<V6DayDoc, "v" | "comments"> & { v: 5; morning: string; notes: string };
export type V4DayDoc = Omit<V5DayDoc, "v" | "ignoredGarminSourceKeys"> & { v: 4 };
export type V3DayDoc = Omit<V4DayDoc, "v" | "activities"> & { v: 3; activities: LegacyActivity[] };
type LegacySession = Omit<Session, "warmup" | "main" | "cooldown"> & {
  warmup: LegacyItem[];
  main: LegacyBlock[];
  cooldown: LegacyItem[];
};
export type LegacyDayDoc = Omit<V3DayDoc, "v" | "sessions"> & { v: 1; sessions: LegacySession[] };
export type V2DayDoc = Omit<V3DayDoc, "v" | "sessions"> & { v: 2; sessions: (Omit<LegacySession, "warmup" | "cooldown"> & { warmup: LegacyBlock[]; cooldown: LegacyBlock[] })[] };

export function migrateLegacyItem(item: LegacyItem): LegacyBlock {
  const value = item.reps.trim();
  let count = 1;
  let reps: number | null = null;
  let weight: number | null = null;
  let comment = item.comment;
  let match: RegExpMatchArray | null;
  if (/^\d+$/.test(value)) reps = Number(value);
  else if ((match = value.match(/^2x(\d+)$/i))) { count = 2; reps = Number(match[1]); }
  else if (/^\d+s$/.test(value)) comment = [comment.trim(), value].filter(Boolean).join("; ");
  else if ((match = value.match(/^(\d+(?:\.\d+)?)kg (\d+)r(?: (each way))?$/i))) {
    weight = Number(match[1]); reps = Number(match[2]);
    if (match[3]) comment = [comment.trim(), match[3]].filter(Boolean).join("; ");
  } else if (value) throw new Error(`Unrecognized reps for ${item.name}: ${value}`);
  if (weight == null && (match = comment.match(/\b(\d+(?:\.\d+)?)\s*kg\b/i))) weight = Number(match[1]);
  const sets: WorkSet[] = Array.from({ length: count }, (_, i) => ({ id: `migrated:set:${item.id}:${i}`, type: "working", weight, reps }));
  return { id: `migrated:block:${item.id}`, exercises: [{ id: item.id, name: item.name, sets, comment }] };
}

function migrateBlock(block: LegacyBlock): SessionItem {
  const members = block.exercises.map(({ id, name, comment }) => ({ id, exerciseId: exerciseIdForName(name), comment }));
  if (members.length <= 1) {
    const ex = block.exercises[0];
    if (!ex) throw new Error("Empty legacy block has no performance");
    return { kind: "exercise", ...members[0], sets: ex.sets };
  }
  const rounds: { id: string; type: WorkSet["type"] }[] = [];
  const values = new Map<string, { weight: number | null; reps: number | null }>();
  for (const [memberIndex, ex] of block.exercises.entries()) {
    for (const [index, set] of ex.sets.entries()) {
      let round = rounds[index];
      if (!round || round.type !== set.type || values.has(`${ex.id}:${round.id}`)) {
        round = { id: rounds.some((r) => r.id === set.id) ? `${set.id}:${memberIndex}` : set.id, type: set.type };
        rounds.push(round);
      }
      values.set(`${ex.id}:${round.id}`, { weight: set.weight, reps: set.reps });
    }
  }
  return { kind: "superset", id: block.id, members, rounds, results: rounds.flatMap((r) => members.map((m) => ({ memberId: m.id, roundId: r.id, ...(values.get(`${m.id}:${r.id}`) ?? { weight: null, reps: null }) }))) };
}

export function migrateDay(doc: LegacyDayDoc | V2DayDoc | V3DayDoc): DayDoc {
  return normalizeDay(migrateCheckins({
    ...doc, v: 5, ignoredGarminSourceKeys: [],
    activities: doc.activities.map(({ id, name, notes, minutes, calories }) => ({
      id, exerciseId: exerciseIdForName(name.trim() || "Activity"), comment: notes,
      result: { minutes, calories },
    })),
    sessions: doc.v === 3 ? doc.sessions : doc.sessions.map((session) => ({
      ...session,
      warmup: session.warmup.map((item) => migrateBlock("exercises" in item ? item : migrateLegacyItem(item))),
      main: session.main.map(migrateBlock),
      cooldown: session.cooldown.map((item) => migrateBlock("exercises" in item ? item : migrateLegacyItem(item))),
    })),
  }));
}

function migrateCheckins(doc: V5DayDoc): V6DayDoc {
  const { morning, notes, ...rest } = doc;
  return {
    ...rest, v: 6,
    comments: [
      ...(morning.trim() ? [{ id: `migrated:morning:${doc.date}:0`, time: "08:00", text: morning }] : []),
      ...(notes.trim() ? [{ id: `migrated:notes:${doc.date}:0`, time: "23:30", text: notes }] : []),
    ],
  };
}

export function normalizeDay(doc: DayDoc | V6DayDoc | V5DayDoc | V4DayDoc | LegacyDayDoc | V2DayDoc | V3DayDoc): DayDoc {
  if (doc.v === 7) return doc;
  if (doc.v === 1 || doc.v === 2 || doc.v === 3) return migrateDay(doc);
  const old = doc.v === 6 ? doc : doc.v === 5 ? migrateCheckins(doc) : migrateCheckins({ ...doc, v: 5, ignoredGarminSourceKeys: [] });
  const { sessions, activities, ...rest } = old;
  return {
    ...rest, v: 7,
    events: [
      ...sessions.map((session) => ({ id: `migrated:session:${session.id}`, title: null, notes: "", entries: [{ kind: "session" as const, session }] })),
      ...activities.map((activity) => ({ id: `migrated:activity:${activity.id}`, title: null, notes: "", entries: [{ kind: "activity" as const, activity }] })),
    ],
  };
}

export function legacyExerciseNames(doc: LegacyDayDoc | V2DayDoc | V3DayDoc): string[] {
  const sessions = doc.v === 3 ? [] : doc.sessions.flatMap((session) => ["warmup", "main", "cooldown"].flatMap((section) =>
    session[section as "warmup" | "main" | "cooldown"].flatMap((item) => "exercises" in item ? item.exercises.map((exercise) => exercise.name) : [item.name])));
  return [...new Set([...sessions, ...doc.activities.map((activity) => activity.name.trim() || "Activity")])];
}
