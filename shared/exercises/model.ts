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

export function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}
