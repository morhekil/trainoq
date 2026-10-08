import { linkedKeys, type DayDoc, type TrainingEvent } from "./model";
import { fitRecordingKey, type GarminActivitySummary } from "../garmin/fit";

/** Source measurements stay separate from the saved, rounded activity values. */
export function eventMeasurements(day: DayDoc, event: TrainingEvent, sources: ReadonlyMap<string, GarminActivitySummary>) {
  const parts = linkedKeys(day).filter((part) => part.event.id === event.id);
  const keys = parts.map((part) => part.sourceKey);
  const sameFit = parts.length > 0 && parts.every((part) => part.entry.kind === "activity") && keys.every((key) => key && fitRecordingKey(key) === fitRecordingKey(keys[0]!));
  const segments = event.entries.flatMap((entry) => entry.kind === "activity" ? entry.activity.segments : []);
  const savedMinutes = sameFit && segments.every((segment) => segment.result.minutes != null)
    ? segments.reduce((total, segment) => total + segment.result.minutes!, 0) : null;
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
