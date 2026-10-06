import type { Session } from "../sessions/model";
import { dayActivities, daySessions, type Activity, type DayComment, type DayDoc, type TrainingEvent } from "./model";

export type DayRecord =
  | { kind: "session"; s: Session; index: number; time: string }
  | { kind: "activity"; a: Activity; time: string | null }
  | { kind: "comment"; comment: DayComment; time: string };

function localTime(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (timeZone) return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function activityTime(activity: Activity, timeZone?: string): string | null {
  if (!activity.startedAt) return null;
  return activity.sourceOffsetMinutes == null
    ? localTime(activity.startedAt, timeZone)
    : new Date(Date.parse(activity.startedAt) + activity.sourceOffsetMinutes * 60_000).toISOString().slice(11, 16);
}

export function orderedDayRecords(day: DayDoc, timeZone?: string): DayRecord[] {
  const sessions = [...daySessions(day)].sort((a, b) => localTime(a.startedAt, timeZone).localeCompare(localTime(b.startedAt, timeZone)));
  return [
    ...sessions.map((s, index) => ({ kind: "session" as const, s, index, time: localTime(s.startedAt, timeZone) })),
    ...dayActivities(day).map((a) => ({ kind: "activity" as const, a, time: activityTime(a, timeZone) })),
    ...day.comments.map((comment) => ({ kind: "comment" as const, comment, time: comment.time })),
  ].sort((a, b) => (a.time ?? "99:99").localeCompare(b.time ?? "99:99"));
}

export type DayTimelineItem = { kind: "event"; event: TrainingEvent; time: string | null } | { kind: "comment"; comment: DayComment; time: string };

export function orderedDayEvents(day: DayDoc, timeZone?: string): DayTimelineItem[] {
  return [
    ...day.events.map((event) => ({
      kind: "event" as const, event,
      time: event.entries.map((entry) => entry.kind === "session" ? localTime(entry.session.startedAt, timeZone) : activityTime(entry.activity, timeZone)).filter((time): time is string => time !== null).sort()[0] ?? null,
    })),
    ...day.comments.map((comment) => ({ kind: "comment" as const, comment, time: comment.time })),
  ].sort((a, b) => (a.time ?? "99:99").localeCompare(b.time ?? "99:99"));
}
