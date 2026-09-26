// One DayDoc per calendar day; stored as JSON in D1 and localStorage.

import type { Session } from "../sessions/model";

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

export function emptyDay(date: string): DayDoc {
  return { v: 1, date, morning: "", sessions: [], activities: [], totalCalories: null, notes: "" };
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
