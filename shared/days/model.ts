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
  v: 8;
  date: string; // YYYY-MM-DD
  comments: DayComment[];
  events: TrainingEvent[];
  ignoredGarminSourceKeys: string[];
  /** total daily active calories (e.g. from the watch), entered manually for now */
  totalCalories: number | null;
}

export function emptyDay(date: string): DayDoc {
  return { v: 8, date, comments: [], events: [], ignoredGarminSourceKeys: [], totalCalories: null };
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

export function mergeEvents(d: DayDoc, ids: string[]): TrainingEvent {
  const selected = ids.map((id) => d.events.find((event) => event.id === id));
  if (ids.length < 2 || new Set(ids).size !== ids.length || selected.some((event) => !event)) throw new Error("Choose distinct events on this day");
  const [target, ...others] = selected as TrainingEvent[];
  if (selected.some((event) => event!.summaryOverrides) || others.some((event) => event.title || event.notes))
    throw new Error("Review event notes and totals before combining");
  target.entries = selected.flatMap((event) => event!.entries).sort((a, b) => {
    const time = (entry: EventEntry) => entry.kind === "session" ? entry.session.startedAt : entry.activity.startedAt ?? "9999";
    return time(a).localeCompare(time(b));
  });
  d.events = d.events.filter((event) => event === target || !ids.includes(event.id));
  return target;
}

export function detachEventEntry(d: DayDoc, eventId: string, kind: EventEntry["kind"], id: string): void {
  const event = d.events.find((item) => item.id === eventId);
  if (!event || event.entries.length < 2) throw new Error("Choose a part of a grouped event");
  const entry = event.entries.find((item) => item.kind === kind && (item.kind === "session" ? item.session.id : item.activity.id) === id);
  if (!entry) throw new Error("Event part not found");
  event.entries = event.entries.filter((item) => item !== entry);
  addEventEntry(d, entry);
}

export function removeEventEntry(d: DayDoc, kind: EventEntry["kind"], id: string): void {
  for (const event of d.events) event.entries = event.entries.filter((entry) => entry.kind !== kind || (entry.kind === "session" ? entry.session.id : entry.activity.id) !== id);
  d.events = d.events.filter((event) => event.entries.length);
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
