import { Decoder, Stream } from "@garmin/fitsdk";

export interface GarminActivitySummary {
  sourceKey: string;
  sport: string;
  subSport: string | null;
  title: string;
  startUtc: string;
  localDate: string | null;
  offsetMinutes: number | null;
  timerSeconds: number | null;
  elapsedSeconds: number | null;
  activeCalories: number;
}

const fitEpoch = Date.UTC(1989, 11, 31);
const nonnegative = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

export function parseGarminFit(bytes: Uint8Array): { activities: GarminActivitySummary[]; rejected: string[] } {
  const decoder = new Decoder(Stream.fromByteArray(bytes));
  if (!decoder.isFIT() || !decoder.checkIntegrity()) throw new Error("Invalid or incomplete FIT file");
  const { messages, errors } = decoder.read();
  if (errors.length) throw new Error("FIT decoding failed");
  const fileId = messages.fileIdMesgs?.[0];
  if (fileId?.type !== "activity" || !nonnegative(fileId.serialNumber) || !(fileId.timeCreated instanceof Date))
    throw new Error("FIT file has no stable activity identity");
  const sessions = messages.sessionMesgs ?? [];
  if (!sessions.length) throw new Error("FIT file has no sessions");

  const localTimestamp = messages.activityMesgs?.[0]?.localTimestamp;
  const firstStart = sessions[0]?.startTime;
  const offset = nonnegative(localTimestamp) && firstStart instanceof Date
    ? Math.round((fitEpoch + localTimestamp * 1000 - firstStart.getTime()) / 60_000)
    : null;
  const offsetMinutes = offset != null && offset >= -720 && offset <= 840 ? offset : null;
  const activities: GarminActivitySummary[] = [];
  const rejected: string[] = [];
  for (const [index, session] of sessions.entries()) {
    if (!(session.startTime instanceof Date) || !Number.isInteger(session.messageIndex) || typeof session.sport !== "string") {
      rejected.push(`Session ${index + 1}: missing start time, index or sport`);
      continue;
    }
    if (!nonnegative(session.totalCalories) || !nonnegative(session.metabolicCalories) || session.metabolicCalories > session.totalCalories) {
      rejected.push(`Session ${index + 1}: missing or inconsistent calorie fields`);
      continue;
    }
    const startUtc = session.startTime.toISOString();
    activities.push({
      sourceKey: `garmin:${fileId.serialNumber}:${fileId.timeCreated.toISOString()}:${session.messageIndex}`,
      sport: session.sport,
      subSport: typeof session.subSport === "string" ? session.subSport : null,
      title: typeof session.sportProfileName === "string" && session.sportProfileName ? session.sportProfileName : session.sport,
      startUtc,
      localDate: offsetMinutes == null ? null : new Date(session.startTime.getTime() + offsetMinutes * 60_000).toISOString().slice(0, 10),
      offsetMinutes,
      timerSeconds: nonnegative(session.totalTimerTime) ? session.totalTimerTime : null,
      elapsedSeconds: nonnegative(session.totalElapsedTime) ? session.totalElapsedTime : null,
      activeCalories: session.totalCalories - session.metabolicCalories,
    });
  }
  return { activities, rejected };
}
