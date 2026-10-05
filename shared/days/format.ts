import { dayActivities, daySessions, type DayDoc } from "./model";
import { countExercises, formatTime, sessionLines } from "../sessions/format";
import { formatNum } from "../exercises/format";
import { seedExercise } from "../exercises/catalog";
import { orderedDayRecords } from "./timeline";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function parseDate(date: string): { y: number; m: number; d: number; weekday: number } {
  const [y, m, d] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { y, m, d, weekday };
}

/** "Tue 22 Sep 2026" */
export function formatDateLong(date: string): string {
  const { y, m, d, weekday } = parseDate(date);
  return `${WEEKDAYS[weekday]} ${d} ${MONTHS[m - 1]} ${y}`;
}

/** "Tue 22 Sep" */
export function formatDateShort(date: string): string {
  const { m, d, weekday } = parseDate(date);
  return `${WEEKDAYS[weekday]} ${d} ${MONTHS[m - 1]}`;
}

/** "5:02pm" in the given (or the device's) time zone */
/** Plain-text summary of a day, for sending to a PT or physio. */
export function dayToText(d: DayDoc, timeZone?: string, resolveName?: (id: string) => string): string {
  const name = resolveName ?? ((id: string) => seedExercise(id)?.name ?? id);
  const out: string[] = [formatDateLong(d.date)];
  let inActivities = false;
  for (const record of orderedDayRecords(d, timeZone)) {
    if (record.kind === "comment") {
      out.push("", `Comment ${record.time}`, record.comment.text.trim());
    } else if (record.kind === "session") {
      out.push("", "----", ...sessionLines(record.s, timeZone, resolveName));
    } else {
      const a = record.a;
      if (!inActivities) out.push("", "----", "Activities");
      const bits = [name(a.exerciseId)];
      if (a.result.minutes != null) bits.push(`${formatNum(a.result.minutes)} min`);
      if (a.result.calories != null) bits.push(`${formatNum(a.result.calories)} cal`);
      out.push(`- ${record.time ? `${record.time} ` : ""}${bits.join(" · ")}${a.comment.trim() ? ` – ${a.comment.trim()}` : ""}`);
    }
    inActivities = record.kind === "activity";
  }
  if (d.totalCalories != null) out.push("", "----");
  if (d.totalCalories != null) out.push(`Total daily active calories: ${formatNum(d.totalCalories)}`);
  return out.join("\n");
}

/** One-line summary for the history list. */
export function daySummary(d: DayDoc, timeZone?: string, resolveName: (id: string) => string = (id) => seedExercise(id)?.name ?? id): string {
  const bits: string[] = [];
  for (const s of daySessions(d)) {
    let t = `Session ${formatTime(s.startedAt, timeZone)} · ${countExercises(s)} exercises`;
    if (s.calories != null) t += ` · ${formatNum(s.calories)} cal`;
    bits.push(t);
  }
  for (const a of dayActivities(d)) bits.push(resolveName(a.exerciseId));
  if (d.totalCalories != null) bits.push(`${formatNum(d.totalCalories)} cal total`);
  return bits.join(" · ");
}
