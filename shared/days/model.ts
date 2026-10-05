// One DayDoc per calendar day; stored as JSON in D1 and localStorage.

import type { Session } from "../sessions/model";
import type { ActivityResult, PerformedExercise } from "../exercises/model";

export type Activity = PerformedExercise & { result: ActivityResult; startedAt?: string; sourceOffsetMinutes?: number; garminSourceKey?: string };

export interface DayComment { id: string; time: string; text: string }

export interface DayDoc {
  v: 6;
  date: string; // YYYY-MM-DD
  comments: DayComment[];
  sessions: Session[];
  activities: Activity[];
  ignoredGarminSourceKeys: string[];
  /** total daily active calories (e.g. from the watch), entered manually for now */
  totalCalories: number | null;
}

export function emptyDay(date: string): DayDoc {
  return { v: 6, date, comments: [], sessions: [], activities: [], ignoredGarminSourceKeys: [], totalCalories: null };
}

export function isDayEmpty(d: DayDoc): boolean {
  return (
    d.comments.length === 0 &&
    d.sessions.length === 0 &&
    d.activities.length === 0 &&
    d.ignoredGarminSourceKeys.length === 0 &&
    d.totalCalories == null
  );
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
