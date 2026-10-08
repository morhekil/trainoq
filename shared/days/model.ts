// One DayDoc per calendar day; stored as JSON in D1 and localStorage.

import type { Session } from "../sessions/model";
import { EFFORT, type ActivityResult, type Effort, type ExerciseHistoryEntry } from "../exercises/model";

/** One timed part of an activity, such as one walk interval of a Garmin recording. */
export interface Segment { id: string; exerciseId: string; startedAt: string; result: ActivityResult }
/** Segments are ordered by time. Name, totals and start are calculated from them. */
export interface Activity { id: string; comment: string; effort?: Effort; segments: Segment[] }

export interface DayComment { id: string; time: string; text: string }

export type EventEntry = { kind: "session"; session: Session } | { kind: "activity"; activity: Activity };

export interface TrainingEvent {
  id: string;
  title: string | null;
  notes: string;
  entries: EventEntry[];
  summaryOverrides?: { elapsedSeconds?: number | null; timerSeconds?: number | null; activeCalories?: number | null };
}

/** A Garmin decision: linked to a session or segment, or ignored (`target: null`). */
export type GarminLink = { sourceKey: string; target: { kind: "session" | "segment"; id: string } | null };

export interface DayDoc {
  v: 9;
  date: string; // YYYY-MM-DD
  comments: DayComment[];
  events: TrainingEvent[];
  garminLinks: GarminLink[];
  /** total daily active calories (e.g. from the watch), entered manually for now */
  totalCalories: number | null;
}

export function emptyDay(date: string): DayDoc {
  return { v: 9, date, comments: [], events: [], garminLinks: [], totalCalories: null };
}

export function isDayEmpty(d: DayDoc): boolean {
  return (
    d.comments.length === 0 &&
    d.events.length === 0 &&
    d.garminLinks.length === 0 &&
    d.totalCalories == null
  );
}

export function daySessions(d: DayDoc): Session[] {
  return d.events.flatMap((event) => event.entries.flatMap((entry) => entry.kind === "session" ? [entry.session] : []));
}

export function dayActivities(d: DayDoc): Activity[] {
  return d.events.flatMap((event) => event.entries.flatMap((entry) => entry.kind === "activity" ? [entry.activity] : []));
}

export const activityStart = (a: Activity): string => a.segments[0].startedAt;
export const activityExercises = (a: Activity): string[] => [...new Set(a.segments.map((segment) => segment.exerciseId))];
/** "Walk/Run": distinct exercises in order of first appearance */
export const activityName = (a: Activity, name: (id: string) => string): string => activityExercises(a).map(name).join("/");
/** Sums over the segments; null only when every segment's value is null. */
export function activityTotals(a: Activity): ActivityResult {
  const total = (key: keyof ActivityResult) => a.segments.every((segment) => segment.result[key] == null)
    ? null : a.segments.reduce((sum, segment) => sum + (segment.result[key] ?? 0), 0);
  return { minutes: total("minutes"), calories: total("calories") };
}

type ActivityHistory = Omit<Extract<ExerciseHistoryEntry, { section: "activity" }>, "date" | "section">;
/**
 * One history record per distinct exercise, totalled over that exercise's segments.
 * `segments` and `with` (the other exercise IDs) appear only for a combined activity, so a plain one reads as before.
 */
export function activityHistory(a: Activity): (ActivityHistory & { exerciseId: string })[] {
  const exercises = activityExercises(a);
  return exercises.map((exerciseId) => {
    const segments = a.segments.filter((segment) => segment.exerciseId === exerciseId);
    return {
      exerciseId, result: activityTotals({ ...a, segments }), ...(a.effort ? { effort: a.effort } : {}),
      ...(a.segments.length > 1 ? { segments: segments.length, with: exercises.filter((id) => id !== exerciseId) } : {}),
    };
  });
}

const entryId = (entry: EventEntry) => entry.kind === "session" ? entry.session.id : entry.activity.id;
const entryStart = (entry: EventEntry) => Date.parse(entry.kind === "session" ? entry.session.startedAt : activityStart(entry.activity));

export type LinkedPart = { event: TrainingEvent; entry: EventEntry; segmentId?: string; sourceKey?: string };
/** Every session and segment of a day with its Garmin source key, if linked. */
export function linkedKeys(d: DayDoc): LinkedPart[] {
  const keys = new Map(d.garminLinks.flatMap((link) => link.target ? [[`${link.target.kind}:${link.target.id}`, link.sourceKey] as const] : []));
  return d.events.flatMap((event) => event.entries.flatMap((entry): LinkedPart[] => entry.kind === "session"
    ? [{ event, entry, sourceKey: keys.get(`session:${entry.session.id}`) }]
    : entry.activity.segments.map((segment) => ({ event, entry, segmentId: segment.id, sourceKey: keys.get(`segment:${segment.id}`) }))));
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
  target.entries = selected.flatMap((event) => event!.entries).sort((a, b) => entryStart(a) - entryStart(b));
  d.events = d.events.filter((event) => event === target || !ids.includes(event.id));
  return target;
}

export function detachEventEntry(d: DayDoc, eventId: string, kind: EventEntry["kind"], id: string): void {
  const event = d.events.find((item) => item.id === eventId);
  if (!event || event.entries.length < 2) throw new Error("Choose a part of a grouped event");
  const entry = event.entries.find((item) => item.kind === kind && entryId(item) === id);
  if (!entry) throw new Error("Event part not found");
  event.entries = event.entries.filter((item) => item !== entry);
  addEventEntry(d, entry);
}

const joinText = (...texts: (string | null)[]) => texts.map((text) => text?.trim()).filter(Boolean).join("\n");

/**
 * Turns an event whose parts are all activities into one activity: every segment in time order,
 * the highest part effort, and the event's title and notes kept in the comment. Links stay on their segments.
 */
export function combineActivities(d: DayDoc, eventId: string): Activity {
  const event = d.events.find((item) => item.id === eventId);
  const parts = event?.entries.flatMap((entry) => entry.kind === "activity" ? [entry.activity] : []) ?? [];
  if (!event || parts.length < 2 || parts.length !== event.entries.length || event.summaryOverrides)
    throw new Error("Choose an event of two or more activities without entered totals");
  const effort = parts.map((part) => part.effort).filter((value) => value != null).sort((a, b) => EFFORT.indexOf(b) - EFFORT.indexOf(a))[0];
  const activity: Activity = {
    id: crypto.randomUUID(),
    comment: joinText(event.title, event.notes, ...parts.map((part) => part.comment)),
    ...(effort ? { effort } : {}),
    segments: parts.flatMap((part) => part.segments).sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt)),
  };
  event.title = null;
  event.notes = "";
  event.entries = [{ kind: "activity", activity }];
  return activity;
}

/** One activity per segment in place of a combined one. The event keeps the name and comment; the effort is dropped. */
export function splitActivity(d: DayDoc, activityId: string, name: (id: string) => string): void {
  const event = d.events.find((item) => item.entries.some((entry) => entry.kind === "activity" && entry.activity.id === activityId));
  const index = event?.entries.findIndex((entry) => entry.kind === "activity" && entry.activity.id === activityId) ?? -1;
  const entry = event?.entries[index];
  if (!event || entry?.kind !== "activity" || entry.activity.segments.length < 2) throw new Error("Choose a combined activity");
  const { activity } = entry;
  event.entries.splice(index, 1, ...activity.segments.map((segment): EventEntry => ({ kind: "activity", activity: { id: segment.id, comment: "", segments: [segment] } })));
  event.title ||= activityName(activity, name);
  event.notes = joinText(event.notes, activity.comment);
}

/** Removes the session or activity and its Garmin links. */
export function removeEventEntry(d: DayDoc, kind: EventEntry["kind"], id: string): void {
  const removed = d.events.flatMap((event) => event.entries.filter((entry) => entry.kind === kind && entryId(entry) === id));
  const targets = new Set(removed.flatMap((entry) => entry.kind === "session" ? [`session:${entry.session.id}`] : entry.activity.segments.map((segment) => `segment:${segment.id}`)));
  d.garminLinks = d.garminLinks.filter((link) => !link.target || !targets.has(`${link.target.kind}:${link.target.id}`));
  for (const event of d.events) event.entries = event.entries.filter((entry) => !removed.includes(entry));
  d.events = d.events.filter((event) => event.entries.length);
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
