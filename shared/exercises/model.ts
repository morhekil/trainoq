export type SetType = "warmup" | "working" | "backoff";

export interface WorkSet {
  id: string;
  type: SetType;
  /** kg. null = not entered, 0 = bodyweight */
  weight: number | null;
  reps: number | null;
}

/** Exercise tracked set by set in any session section. */
export interface Exercise {
  id: string;
  name: string;
  sets: WorkSet[];
  comment: string;
}

/** One exercise = straight sets, two or more = superset. */
export interface Block {
  id: string;
  exercises: Exercise[];
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
  section: Section;
  sets: Pick<WorkSet, "type" | "weight" | "reps">[];
}

export interface ExerciseLibrary {
  stats: ExerciseStat[];
  /** recent entries per name_key and section, newest first */
  history: Record<string, ExerciseHistoryEntry[]>;
}

export function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}
