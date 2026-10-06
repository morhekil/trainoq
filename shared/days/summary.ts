import type { TrainingEvent } from "./model";
import { fitRecordingKey, type GarminActivitySummary } from "../garmin/fit";

/** Source measurements stay separate from the saved, rounded activity values. */
export function eventMeasurements(event: TrainingEvent, sources: ReadonlyMap<string, GarminActivitySummary>) {
  const activities = event.entries.flatMap((entry) => entry.kind === "activity" ? [entry.activity] : []);
  const keys = activities.map((activity) => activity.garminSourceKey);
  const sameFit = activities.length === event.entries.length && keys.every((key) => key && fitRecordingKey(key) === fitRecordingKey(keys[0]!));
  const savedMinutes = sameFit && activities.every((activity) => activity.result.minutes != null)
    ? activities.reduce((total, activity) => total + activity.result.minutes!, 0) : null;
  const recordings = sameFit ? keys.map((key) => sources.get(key!)) : [];
  const sourceComplete = sameFit && recordings.every((source) => source != null);
  const timerSeconds = sourceComplete && recordings.every((source) => source!.timerSeconds != null)
    ? recordings.reduce((total, source) => total + source!.timerSeconds!, 0) : null;
  const elapsedSeconds = sourceComplete && recordings.every((source) => source!.elapsedSeconds != null)
    ? (Math.max(...recordings.map((source) => Date.parse(source!.startUtc) + source!.elapsedSeconds! * 1000)) - Math.min(...recordings.map((source) => Date.parse(source!.startUtc)))) / 1000 : null;
  const activeCalories = sourceComplete ? recordings.reduce((total, source) => total + source!.activeCalories, 0) : null;
  return {
    savedMinutes,
    timerSeconds: event.summaryOverrides?.timerSeconds === undefined ? timerSeconds : event.summaryOverrides.timerSeconds,
    elapsedSeconds: event.summaryOverrides?.elapsedSeconds === undefined ? elapsedSeconds : event.summaryOverrides.elapsedSeconds,
    activeCalories: event.summaryOverrides?.activeCalories === undefined ? activeCalories : event.summaryOverrides.activeCalories,
    sourceComplete,
  };
}
