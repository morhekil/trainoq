// One DayDoc per calendar day; stored as JSON in D1 and localStorage.

import type { Session } from "../sessions/model";
import type { ActivityResult, PerformedExercise } from "../exercises/model";

export type Activity = PerformedExercise & { result: ActivityResult; startedAt?: string; sourceOffsetMinutes?: number; garminSourceKey?: string };

export interface DayComment { id: string; time: string; text: string }

export type EventEntry = { kind: "session"; session: Session } | { kind: "activity"; activity: Activity };

export interface TrainingEvent {
  id: string;
  title: string | null;
  notes: string;
  entries: EventEntry[];
  summaryOverrides?: { elapsedSeconds?: number | null; timerSeconds?: number | null; activeCalories?: number | null };
}

export interface DayDoc {
  v: 7;
  date: string; // YYYY-MM-DD
  comments: DayComment[];
  events: TrainingEvent[];
  ignoredGarminSourceKeys: string[];
  /** total daily active calories (e.g. from the watch), entered manually for now */
  totalCalories: number | null;
}

export function emptyDay(date: string): DayDoc {
  return { v: 7, date, comments: [], events: [], ignoredGarminSourceKeys: [], totalCalories: null };
}

export function isDayEmpty(d: DayDoc): boolean {
  return (
    d.comments.length === 0 &&
    d.events.length === 0 &&
    d.ignoredGarminSourceKeys.length === 0 &&
    d.totalCalories == null
  );
}

export function daySessions(d: DayDoc): Session[] {
  return d.events.flatMap((event) => event.entries.flatMap((entry) => entry.kind === "session" ? [entry.session] : []));
}

export function dayActivities(d: DayDoc): Activity[] {
  return d.events.flatMap((event) => event.entries.flatMap((entry) => entry.kind === "activity" ? [entry.activity] : []));
}

export function addEventEntry(d: DayDoc, entry: EventEntry): TrainingEvent {
  const event: TrainingEvent = { id: crypto.randomUUID(), title: null, notes: "", entries: [entry] };
  d.events.push(event);
  return event;
}

export function removeEventEntry(d: DayDoc, kind: EventEntry["kind"], id: string): void {
  for (const event of d.events) event.entries = event.entries.filter((entry) => entry.kind !== kind || (entry.kind === "session" ? entry.session.id : entry.activity.id) !== id);
  d.events = d.events.filter((event) => event.entries.length);
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
