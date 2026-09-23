// Data model. One DayDoc per calendar day; stored as JSON in D1 and in localStorage.

export type SetType = "warmup" | "working" | "backoff";

export interface WorkSet {
  id: string;
  type: SetType;
  /** kg. null = not entered, 0 = bodyweight */
  weight: number | null;
  reps: number | null;
}

/** Exercise in the main part of a session: tracked set by set. */
export interface MainExercise {
  id: string;
  name: string;
  sets: WorkSet[];
  comment: string;
}

/** A main-training block. One exercise = straight sets, two or more = superset. */
export interface Block {
  id: string;
  exercises: MainExercise[];
}

/** Warm-up / cool-down entry: just a name and reps (free text so "30s" or "2x10" works). */
export interface SimpleItem {
  id: string;
  name: string;
  reps: string;
  comment: string;
}

export interface Session {
  id: string;
  startedAt: string; // ISO timestamp
  endedAt: string | null;
  warmup: SimpleItem[];
  main: Block[];
  cooldown: SimpleItem[];
  /** active calories for the session, entered manually for now */
  calories: number | null;
  notes: string;
}

/** Anything outside a training session: walk, ride, climbing... */
export interface Activity {
  id: string;
  name: string;
  minutes: number | null;
  calories: number | null;
  notes: string;
}

export interface DayDoc {
  v: 1;
  date: string; // YYYY-MM-DD
  morning: string;
  sessions: Session[];
  activities: Activity[];
  /** total daily active calories (e.g. from the watch), entered manually for now */
  totalCalories: number | null;
  notes: string;
}

export type Section = "warmup" | "main" | "cooldown";

export interface ExerciseStat {
  name: string;
  count: number;
  last: string; // date
  sections: Partial<Record<Section, number>>;
}

export interface ExerciseHistoryEntry {
  date: string;
  sets: Pick<WorkSet, "type" | "weight" | "reps">[];
}

export interface ExerciseLibrary {
  stats: ExerciseStat[];
  /** most recent main-training entries per name_key, newest first */
  history: Record<string, ExerciseHistoryEntry[]>;
}

export function emptyDay(date: string): DayDoc {
  return { v: 1, date, morning: "", sessions: [], activities: [], totalCalories: null, notes: "" };
}

export function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function isDayEmpty(d: DayDoc): boolean {
  return (
    !d.morning.trim() &&
    d.sessions.length === 0 &&
    d.activities.length === 0 &&
    d.totalCalories == null &&
    !d.notes.trim()
  );
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
