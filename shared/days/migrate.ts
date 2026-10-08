import { exerciseIdForName } from "../exercises/catalog";
import type { ActivityResult, PerformedExercise, SessionItem, SetType, StandaloneExercise, Superset, WorkSet } from "../exercises/model";
import type { DayDoc, EventEntry, GarminLink, TrainingEvent } from "./model";
import type { Session } from "../sessions/model";
import type { ParamSet } from "../exercises/params";
import { atClock, formatOffset, withOffset } from "./time";

// ponytail: v8 saved UTC instants without a zone. One home zone suits this single-user app; other users would need a zone setting.
const HOME_TIME_ZONE = "Australia/Sydney";
function homeOffset(instant: string): string {
  const zone = new Intl.DateTimeFormat("en-AU", { timeZone: HOME_TIME_ZONE, timeZoneName: "longOffset" })
    .formatToParts(new Date(instant)).find((part) => part.type === "timeZoneName")!.value;
  return zone === "GMT" ? "+00:00" : zone.slice(3);
}
export const homeTime = (instant: string): string => withOffset(instant, homeOffset(instant));

export type V8Activity = PerformedExercise & { result: ActivityResult; startedAt?: string; sourceOffsetMinutes?: number; garminSourceKey?: string };
type V8Session = Session & { garminSourceKey?: string };
type V8Event = Omit<TrainingEvent, "entries"> & { entries: ({ kind: "session"; session: V8Session } | { kind: "activity"; activity: V8Activity })[] };
export type V8DayDoc = Omit<DayDoc, "v" | "events" | "garminLinks"> & { v: 8; events: V8Event[]; ignoredGarminSourceKeys: string[] };

type OldValues = { weight: number | null; reps: number | null };
export type V7SessionItem =
  | (Omit<StandaloneExercise, "params" | "setup" | "sets"> & { sets: ({ id: string; type: SetType } & OldValues)[] })
  | (Omit<Superset, "members" | "results"> & { members: PerformedExercise[]; results: ({ memberId: string; roundId: string } & OldValues)[] });
type V7Session = Omit<V8Session, "warmup" | "main" | "cooldown"> & { warmup: V7SessionItem[]; main: V7SessionItem[]; cooldown: V7SessionItem[] };
type V7Event = Omit<TrainingEvent, "entries"> & { entries: ({ kind: "session"; session: V7Session } | { kind: "activity"; activity: V8Activity })[] };
export type V7DayDoc = Omit<V8DayDoc, "v" | "events"> & { v: 7; events: V7Event[] };

export interface LegacyExercise { id: string; name: string; sets: ({ id: string; type: SetType } & OldValues)[]; comment: string }
export interface LegacyBlock { id: string; exercises: LegacyExercise[] }
export interface LegacyItem { id: string; name: string; reps: string; comment: string }
export interface LegacyActivity { id: string; name: string; minutes: number | null; calories: number | null; notes: string }
export type V6DayDoc = Omit<V7DayDoc, "v" | "events"> & { v: 6; sessions: V7Session[]; activities: V8Activity[] };
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
  const sets: LegacyExercise["sets"] = Array.from({ length: count }, (_, i) => ({ id: `migrated:set:${item.id}:${i}`, type: "working", weight, reps }));
  return { id: `migrated:block:${item.id}`, exercises: [{ id: item.id, name: item.name, sets, comment }] };
}

function migrateBlock(block: LegacyBlock): V7SessionItem {
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

export function migrateDay(doc: LegacyDayDoc | V2DayDoc | V3DayDoc): DayDoc { return normalizeDay(doc); }

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

function normalizeToV7(doc: V7DayDoc | V6DayDoc | V5DayDoc | V4DayDoc | LegacyDayDoc | V2DayDoc | V3DayDoc): V7DayDoc {
  if (doc.v === 7) return doc;
  if (doc.v === 1 || doc.v === 2 || doc.v === 3) return normalizeToV7(migrateCheckins({
    ...doc, v: 5, ignoredGarminSourceKeys: [],
    activities: doc.activities.map(({ id, name, notes, minutes, calories }) => ({ id, exerciseId: exerciseIdForName(name.trim() || "Activity"), comment: notes, result: { minutes, calories } })),
    sessions: doc.v === 3 ? doc.sessions : doc.sessions.map((session) => ({
      ...session,
      warmup: session.warmup.map((item) => migrateBlock("exercises" in item ? item : migrateLegacyItem(item))),
      main: session.main.map(migrateBlock),
      cooldown: session.cooldown.map((item) => migrateBlock("exercises" in item ? item : migrateLegacyItem(item))),
    })),
  }));
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

const v7Params = (): ParamSet => ({ perSet: ["weight", "reps"] });
function itemToV8(item: V7SessionItem): SessionItem {
  return item.kind === "exercise"
    ? { ...item, params: v7Params() }
    : { ...item, members: item.members.map((member) => ({ ...member, params: v7Params() })) };
}

export function toV8(doc: V7DayDoc): V8DayDoc {
  return { ...doc, v: 8, events: doc.events.map((event) => ({
    ...event, entries: event.entries.map((entry) => entry.kind === "activity" ? entry : ({
      ...entry, session: { ...entry.session,
        warmup: entry.session.warmup.map(itemToV8),
        main: entry.session.main.map(itemToV8),
        cooldown: entry.session.cooldown.map(itemToV8),
      },
    })),
  })) };
}

/** Pre-v5 drafts may lack an activity start; they get noon at the home offset. */
function activityStartV9(date: string, a: V8Activity): string {
  if (!a.startedAt) return atClock(date, "12:00", homeOffset(`${date}T02:00:00Z`));
  return a.sourceOffsetMinutes == null ? homeTime(a.startedAt) : withOffset(a.startedAt, formatOffset(a.sourceOffsetMinutes));
}

export function toV9(doc: V8DayDoc): DayDoc {
  const { ignoredGarminSourceKeys, events, ...rest } = doc;
  const garminLinks: GarminLink[] = [];
  const entry = (part: V8Event["entries"][number]): EventEntry => {
    if (part.kind === "session") {
      const { garminSourceKey, ...session } = part.session;
      if (garminSourceKey) garminLinks.push({ sourceKey: garminSourceKey, target: { kind: "session", id: session.id } });
      return { kind: "session", session: { ...session, startedAt: homeTime(session.startedAt), endedAt: session.endedAt && homeTime(session.endedAt) } };
    }
    const { id, exerciseId, comment, effort, result, garminSourceKey } = part.activity;
    if (garminSourceKey) garminLinks.push({ sourceKey: garminSourceKey, target: { kind: "segment", id } });
    return { kind: "activity", activity: { id, comment, ...(effort ? { effort } : {}), segments: [{ id, exerciseId, startedAt: activityStartV9(doc.date, part.activity), result }] } };
  };
  const converted = events.map((event) => ({ ...event, entries: event.entries.map(entry) }));
  return { ...rest, v: 9, events: converted, garminLinks: [...garminLinks, ...ignoredGarminSourceKeys.map((sourceKey) => ({ sourceKey, target: null }))] };
}

export function normalizeDay(doc: DayDoc | V8DayDoc | V7DayDoc | V6DayDoc | V5DayDoc | V4DayDoc | LegacyDayDoc | V2DayDoc | V3DayDoc): DayDoc {
  if (doc.v === 9) return doc;
  return toV9(doc.v === 8 ? doc : toV8(normalizeToV7(doc)));
}

export function legacyExerciseNames(doc: LegacyDayDoc | V2DayDoc | V3DayDoc): string[] {
  const sessions = doc.v === 3 ? [] : doc.sessions.flatMap((session) => ["warmup", "main", "cooldown"].flatMap((section) =>
    session[section as "warmup" | "main" | "cooldown"].flatMap((item) => "exercises" in item ? item.exercises.map((exercise) => exercise.name) : [item.name])));
  return [...new Set([...sessions, ...doc.activities.map((activity) => activity.name.trim() || "Activity")])];
}
