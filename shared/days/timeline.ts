import type { Session } from "../sessions/model";
import { activityStart, dayActivities, daySessions, type Activity, type DayComment, type DayDoc, type TrainingEvent } from "./model";
import { clockTime } from "./time";

export type DayRecord =
  | { kind: "session"; s: Session; index: number; time: string }
  | { kind: "activity"; a: Activity; time: string }
  | { kind: "comment"; comment: DayComment; time: string };

export const activityTime = (activity: Activity): string => clockTime(activityStart(activity));

/** Records in clock-time order, as recorded. */
export function orderedDayRecords(day: DayDoc): DayRecord[] {
  const sessions = [...daySessions(day)].sort((a, b) => clockTime(a.startedAt).localeCompare(clockTime(b.startedAt)));
  return [
    ...sessions.map((s, index) => ({ kind: "session" as const, s, index, time: clockTime(s.startedAt) })),
    ...dayActivities(day).map((a) => ({ kind: "activity" as const, a, time: activityTime(a) })),
    ...day.comments.map((comment) => ({ kind: "comment" as const, comment, time: comment.time })),
  ].sort((a, b) => a.time.localeCompare(b.time));
}

export type DayTimelineItem = { kind: "event"; event: TrainingEvent; time: string } | { kind: "comment"; comment: DayComment; time: string };

export function orderedDayEvents(day: DayDoc): DayTimelineItem[] {
  return [
    ...day.events.map((event) => ({
      kind: "event" as const, event,
      time: event.entries.map((entry) => entry.kind === "session" ? clockTime(entry.session.startedAt) : activityTime(entry.activity)).sort()[0],
    })),
    ...day.comments.map((comment) => ({ kind: "comment" as const, comment, time: comment.time })),
  ].sort((a, b) => a.time.localeCompare(b.time));
}
