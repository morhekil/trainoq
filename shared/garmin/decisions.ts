import { addEventEntry, dayActivities, daySessions, linkedKeys, removeEventEntry, type Activity, type DayDoc } from "../days/model";
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
  return daySessions(doc).filter((session) => session.endedAt && !isLinked(doc, session.id) && Math.abs(Date.parse(session.startedAt) - started) <= 60 * 60 * 1000).map((session) => session.id);
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
  const session = daySessions(doc).find((item) => item.id === sessionId && item.endedAt && !isLinked(doc, item.id));
  if (!session) throw new Error("Choose an unlinked completed session");
  doc.garminLinks.push({ sourceKey: source.sourceKey, target: { kind: "session", id: session.id } });
  session.calories ??= source.activeCalories;
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
