import { addEventEntry, dayActivities, daySessions, linkedKeys, mergeEvents, removeEventEntry, type Activity, type DayDoc } from "../days/model";
import { formatOffset, withOffset } from "../days/time";
import { fitRecordingKey, type GarminActivitySummary } from "./fit";

export function suggestedRecordingGroups(doc: DayDoc): string[][] {
  const groups = new Map<string, string[]>();
  const parts = linkedKeys(doc);
  for (const event of doc.events) {
    if (event.title || event.notes || event.summaryOverrides) continue;
    const keys = parts.filter((part) => part.event.id === event.id).map((part) => part.sourceKey);
    if (keys.some((key) => !key)) continue;
    const recordingKeys = new Set(keys.map((key) => fitRecordingKey(key!)));
    if (recordingKeys.size !== 1) continue;
    const recordingKey = [...recordingKeys][0];
    groups.set(recordingKey, [...(groups.get(recordingKey) ?? []), event.id]);
  }
  return [...groups.values()].filter((ids) => ids.length > 1);
}

function ensurePending(doc: DayDoc, key: string): void {
  if (doc.garminLinks.some((link) => link.sourceKey === key)) throw new Error("Garmin activity already decided on this day");
}

const isLinked = (doc: DayDoc, sessionId: string) => doc.garminLinks.some((link) => link.target?.kind === "session" && link.target.id === sessionId);

export function strengthMatches(doc: DayDoc, source: GarminActivitySummary): string[] {
  if (source.localDate !== doc.date || source.subSport !== "strengthTraining") return [];
  const started = Date.parse(source.startUtc);
  return daySessions(doc).filter((session) => !isLinked(doc, session.id) && Math.abs(Date.parse(session.startedAt) - started) <= 60 * 60 * 1000).map((session) => session.id);
}

export function acceptActivity(doc: DayDoc, source: GarminActivitySummary, exerciseId: string): Activity {
  ensurePending(doc, source.sourceKey);
  const id = crypto.randomUUID();
  const offset = formatOffset(source.offsetMinutes ?? -new Date(source.startUtc).getTimezoneOffset());
  const activity: Activity = { id, comment: "", segments: [{
    id, exerciseId, startedAt: withOffset(source.startUtc, offset),
    result: { minutes: source.timerSeconds == null ? null : Math.round(source.timerSeconds / 60), calories: source.activeCalories },
  }] };
  addEventEntry(doc, { kind: "activity", activity });
  doc.garminLinks.push({ sourceKey: source.sourceKey, target: { kind: "segment", id } });
  return activity;
}

export function linkStrengthSession(doc: DayDoc, source: GarminActivitySummary, sessionId: string): void {
  ensurePending(doc, source.sourceKey);
  const session = daySessions(doc).find((item) => item.id === sessionId && !isLinked(doc, item.id));
  if (!session) throw new Error("Choose an unlinked session");
  doc.garminLinks.push({ sourceKey: source.sourceKey, target: { kind: "session", id: session.id } });
  session.calories ??= source.activeCalories;
  // The watch timed the workout, so it closes a session left running and corrects a late or early finish.
  const offset = session.startedAt.slice(19);
  const seconds = source.elapsedSeconds ?? source.timerSeconds;
  session.startedAt = withOffset(source.startUtc, offset);
  if (seconds != null) session.endedAt = withOffset(new Date(Date.parse(source.startUtc) + seconds * 1000).toISOString(), offset);
}

/**
 * Decides one day's pending recordings the way review usually would: a strength recording links to its only matching
 * session, and any other recording becomes an activity, with the parts of one recording in one training event.
 * Returns the decided source keys; the rest stay pending.
 */
export function autoImport(doc: DayDoc, sources: GarminActivitySummary[], exerciseId: (title: string) => string): string[] {
  const decided: string[] = [];
  const recordings = new Map<string, string[]>();
  for (const source of sources) {
    if (doc.garminLinks.some((link) => link.sourceKey === source.sourceKey)) continue;
    if (source.subSport === "strengthTraining") {
      const matches = strengthMatches(doc, source);
      if (matches.length !== 1) continue;
      linkStrengthSession(doc, source, matches[0]);
    } else {
      acceptActivity(doc, source, exerciseId(source.title));
      const recording = fitRecordingKey(source.sourceKey);
      recordings.set(recording, [...(recordings.get(recording) ?? []), doc.events.at(-1)!.id]);
    }
    decided.push(source.sourceKey);
  }
  for (const events of recordings.values()) if (events.length > 1) mergeEvents(doc, events);
  return decided;
}

export function ignoreGarmin(doc: DayDoc, key: string): void {
  ensurePending(doc, key);
  doc.garminLinks.push({ sourceKey: key, target: null });
}

export function unlinkGarmin(doc: DayDoc, key: string): void {
  doc.garminLinks = doc.garminLinks.filter((link) => link.sourceKey !== key);
}

export function moveLinkedActivity(from: DayDoc, to: DayDoc, key: string): void {
  if (from.date === to.date) throw new Error("Choose another day");
  ensurePending(to, key);
  const link = from.garminLinks.find((item) => item.sourceKey === key && item.target?.kind === "segment");
  const activity = dayActivities(from).find((item) => item.segments.some((segment) => segment.id === link?.target?.id));
  if (!link?.target || !activity) throw new Error("Linked activity is missing from this day");
  if (activity.segments.length > 1) throw new Error("Split the combined activity first");
  removeEventEntry(from, "activity", activity.id);
  activity.segments[0].startedAt = to.date + activity.segments[0].startedAt.slice(10);
  addEventEntry(to, { kind: "activity", activity });
  to.garminLinks.push({ sourceKey: key, target: link.target });
}
