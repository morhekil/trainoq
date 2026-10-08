export type SetType = "warmup" | "working" | "backoff";
import type { ParamSet, ParamValues } from "./params";

export type SetValues = ParamValues;
export type WorkSet = ParamValues & { id: string; type: SetType };
export type ActivityResult = { minutes: number | null; calories: number | null };

export interface Exercise { id: string; name: string }
/** How hard an entry was, on the RPE scale. Rep-based exercises show it as reps in reserve. */
export const EFFORT = ["low", "med", "high", "max"] as const;
export type Effort = (typeof EFFORT)[number];
export interface PerformedExercise { id: string; exerciseId: string; comment: string; effort?: Effort }
export type SessionExercise = PerformedExercise & { params: ParamSet; setup?: ParamValues };
export type StandaloneExercise = SessionExercise & { kind: "exercise"; sets: WorkSet[] };
export interface Superset {
  kind: "superset";
  id: string;
  members: SessionExercise[];
  rounds: { id: string; type: SetType }[];
  results: (ParamValues & { memberId: string; roundId: string })[];
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
export type SessionHistoryEntry = { date: string; section: Section; params: ParamSet; setup?: ParamValues; sets: (Pick<WorkSet, "type"> & ParamValues)[]; effort?: Effort };
export type ExerciseHistoryEntry =
  | SessionHistoryEntry
  | { date: string; section: "activity"; result: ActivityResult; effort?: Effort; segments?: number; with?: string[] };
export interface ExerciseLibrary {
  catalog: (Exercise & { section: ExerciseContext | "any" | null; aliases: string })[];
  stats: ExerciseStat[];
  history: Record<string, ExerciseHistoryEntry[]>;
  params: Record<string, ParamSet>;
  templates: ParamTemplate[];
}
export interface ParamTemplate { id: string; name: string; params: ParamSet }
export function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}
