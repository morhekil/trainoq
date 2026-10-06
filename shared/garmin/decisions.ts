import { addEventEntry, dayActivities, daySessions, removeEventEntry, type Activity, type DayDoc } from "../days/model";
import { fitRecordingKey, type GarminActivitySummary } from "./fit";

export function suggestedRecordingGroups(doc: DayDoc): string[][] {
  const groups = new Map<string, string[]>();
  for (const event of doc.events) {
    if (event.title || event.notes || event.summaryOverrides) continue;
    const keys = event.entries.map((entry) => entry.kind === "session" ? entry.session.garminSourceKey : entry.activity.garminSourceKey);
    if (keys.some((key) => !key)) continue;
    const recordingKeys = new Set(keys.map((key) => fitRecordingKey(key!)));
    if (recordingKeys.size !== 1) continue;
    const recordingKey = [...recordingKeys][0];
    groups.set(recordingKey, [...(groups.get(recordingKey) ?? []), event.id]);
  }
  return [...groups.values()].filter((ids) => ids.length > 1);
}

function ensurePending(doc: DayDoc, key: string): void {
  if (doc.ignoredGarminSourceKeys.includes(key) || dayActivities(doc).some((a) => a.garminSourceKey === key) || daySessions(doc).some((s) => s.garminSourceKey === key))
    throw new Error("Garmin activity already decided on this day");
}

export function strengthMatches(doc: DayDoc, source: GarminActivitySummary): string[] {
  if (source.localDate !== doc.date || source.subSport !== "strengthTraining") return [];
  const started = Date.parse(source.startUtc);
  return daySessions(doc).filter((session) => session.endedAt && !session.garminSourceKey && Math.abs(Date.parse(session.startedAt) - started) <= 60 * 60 * 1000).map((session) => session.id);
}

export function acceptActivity(doc: DayDoc, source: GarminActivitySummary, exerciseId: string): Activity {
  ensurePending(doc, source.sourceKey);
  const activity: Activity = {
    id: crypto.randomUUID(), exerciseId, comment: "", startedAt: source.startUtc,
    ...(source.offsetMinutes == null ? {} : { sourceOffsetMinutes: source.offsetMinutes }),
    garminSourceKey: source.sourceKey,
    result: { minutes: source.timerSeconds == null ? null : Math.round(source.timerSeconds / 60), calories: source.activeCalories },
  };
  addEventEntry(doc, { kind: "activity", activity });
  return activity;
}

export function linkStrengthSession(doc: DayDoc, source: GarminActivitySummary, sessionId: string): void {
  ensurePending(doc, source.sourceKey);
  const session = daySessions(doc).find((item) => item.id === sessionId && item.endedAt && !item.garminSourceKey);
  if (!session) throw new Error("Choose an unlinked completed session");
  session.garminSourceKey = source.sourceKey;
  session.calories ??= source.activeCalories;
}

export function ignoreGarmin(doc: DayDoc, key: string): void {
  ensurePending(doc, key);
  doc.ignoredGarminSourceKeys.push(key);
}

export function unlinkGarmin(doc: DayDoc, key: string): void {
  doc.ignoredGarminSourceKeys = doc.ignoredGarminSourceKeys.filter((item) => item !== key);
  for (const session of daySessions(doc)) if (session.garminSourceKey === key) delete session.garminSourceKey;
  for (const activity of dayActivities(doc)) if (activity.garminSourceKey === key) delete activity.garminSourceKey;
}

export function moveLinkedActivity(from: DayDoc, to: DayDoc, key: string): void {
  if (from.date === to.date) throw new Error("Choose another day");
  ensurePending(to, key);
  const activity = dayActivities(from).find((item) => item.garminSourceKey === key);
  if (!activity) throw new Error("Linked activity is missing from this day");
  removeEventEntry(from, "activity", activity.id);
  if (activity.startedAt) {
    const offset = activity.sourceOffsetMinutes ?? 0;
    const localTime = new Date(Date.parse(activity.startedAt) + offset * 60_000).toISOString().slice(11);
    activity.startedAt = new Date(Date.parse(`${to.date}T${localTime}`) - offset * 60_000).toISOString();
  }
  addEventEntry(to, { kind: "activity", activity });
}
