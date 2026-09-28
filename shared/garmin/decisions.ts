import type { Activity, DayDoc } from "../days/model";
import type { GarminActivitySummary } from "./fit";

function ensurePending(doc: DayDoc, key: string): void {
  if (doc.ignoredGarminSourceKeys.includes(key) || doc.activities.some((a) => a.garminSourceKey === key) || doc.sessions.some((s) => s.garminSourceKey === key))
    throw new Error("Garmin activity already decided on this day");
}

export function strengthMatches(doc: DayDoc, source: GarminActivitySummary): string[] {
  if (source.localDate !== doc.date || source.subSport !== "strengthTraining") return [];
  const started = Date.parse(source.startUtc);
  return doc.sessions.filter((session) => session.endedAt && !session.garminSourceKey && Math.abs(Date.parse(session.startedAt) - started) <= 60 * 60 * 1000).map((session) => session.id);
}

export function acceptActivity(doc: DayDoc, source: GarminActivitySummary, exerciseId: string): Activity {
  ensurePending(doc, source.sourceKey);
  const activity: Activity = {
    id: crypto.randomUUID(), exerciseId, comment: "", startedAt: source.startUtc,
    garminSourceKey: source.sourceKey,
    result: { minutes: source.timerSeconds == null ? null : Math.round(source.timerSeconds / 60), calories: source.activeCalories },
  };
  doc.activities.push(activity);
  return activity;
}

export function linkStrengthSession(doc: DayDoc, source: GarminActivitySummary, sessionId: string): void {
  ensurePending(doc, source.sourceKey);
  const session = doc.sessions.find((item) => item.id === sessionId && item.endedAt && !item.garminSourceKey);
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
  for (const session of doc.sessions) if (session.garminSourceKey === key) delete session.garminSourceKey;
  for (const activity of doc.activities) if (activity.garminSourceKey === key) delete activity.garminSourceKey;
}
