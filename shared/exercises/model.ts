export type SetType = "warmup" | "working" | "backoff";
export type SetValues = { weight: number | null; reps: number | null };
export type WorkSet = SetValues & { id: string; type: SetType };
export type ActivityResult = { minutes: number | null; calories: number | null };

export interface Exercise { id: string; name: string }
export interface PerformedExercise { id: string; exerciseId: string; comment: string }
export type StandaloneExercise = PerformedExercise & { kind: "exercise"; sets: WorkSet[] };
export interface Superset {
  kind: "superset";
  id: string;
  members: PerformedExercise[];
  rounds: { id: string; type: SetType }[];
  results: (SetValues & { memberId: string; roundId: string })[];
}
export type SessionItem = StandaloneExercise | Superset;
export type Section = "warmup" | "main" | "cooldown";
export type ExerciseContext = Section | "activity";

export interface ExerciseStat {
  exerciseId: string;
  count: number;
  last: string;
  sections: Partial<Record<ExerciseContext, number>>;
}
export type ExerciseHistoryEntry =
  | { date: string; section: Section; sets: Pick<WorkSet, "type" | "weight" | "reps">[] }
  | { date: string; section: "activity"; result: ActivityResult };
export interface ExerciseLibrary {
  catalog: (Exercise & { section: ExerciseContext | "any" | null; aliases: string })[];
  stats: ExerciseStat[];
  history: Record<string, ExerciseHistoryEntry[]>;
}
export function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}
