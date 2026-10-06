import type { Activity, DayDoc } from "./model";
import { countExercises, formatTime, sessionLines } from "../sessions/format";
import { formatNum } from "../exercises/format";
import { seedExercise } from "../exercises/catalog";
import { activityTime, orderedDayEvents } from "./timeline";

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
  const activityLine = (a: Activity) => {
    const bits = [name(a.exerciseId)];
    if (a.result.minutes != null) bits.push(`${formatNum(a.result.minutes)} min`);
    if (a.result.calories != null) bits.push(`${formatNum(a.result.calories)} cal`);
    const time = activityTime(a, timeZone);
    return `- ${time ? `${time} ` : ""}${bits.join(" · ")}${a.comment.trim() ? ` – ${a.comment.trim()}` : ""}`;
  };
  let inActivities = false;
  for (const record of orderedDayEvents(d, timeZone)) {
    if (record.kind === "comment") {
      out.push("", `Comment ${record.time}`, record.comment.text.trim());
      inActivities = false;
    } else if (record.event.entries.length > 1 || record.event.title || record.event.notes) {
      const event = record.event;
      out.push("", "----", `${event.title?.trim() || "Training event"} (${event.entries.length} ${event.entries.length === 1 ? "part" : "parts"})`);
      if (event.notes.trim()) out.push(event.notes.trim());
      for (const entry of event.entries) {
        if (entry.kind === "session") out.push("", ...sessionLines(entry.session, timeZone, resolveName));
        else out.push(activityLine(entry.activity));
      }
      inActivities = false;
    } else {
      const entry = record.event.entries[0];
      if (entry.kind === "session") {
        out.push("", "----", ...sessionLines(entry.session, timeZone, resolveName));
        inActivities = false;
      } else {
        if (!inActivities) out.push("", "----", "Activities");
        out.push(activityLine(entry.activity));
        inActivities = true;
      }
    }
  }
  if (d.totalCalories != null) out.push("", "----");
  if (d.totalCalories != null) out.push(`Total daily active calories: ${formatNum(d.totalCalories)}`);
  return out.join("\n");
}

/** One-line summary for the history list. */
export function daySummary(d: DayDoc, timeZone?: string, resolveName: (id: string) => string = (id) => seedExercise(id)?.name ?? id): string {
  const bits: string[] = [];
  for (const record of orderedDayEvents(d, timeZone)) {
    if (record.kind === "comment") continue;
    const event = record.event;
    if (event.entries.length > 1 || event.title || event.notes) {
      bits.push(`${event.title?.trim() || "Training event"} (${event.entries.length} ${event.entries.length === 1 ? "part" : "parts"})`);
      continue;
    }
    const entry = event.entries[0];
    if (entry.kind === "activity") {
      bits.push(resolveName(entry.activity.exerciseId));
      continue;
    }
    const s = entry.session;
    let t = `Session ${formatTime(s.startedAt, timeZone)} · ${countExercises(s)} exercises`;
    if (s.calories != null) t += ` · ${formatNum(s.calories)} cal`;
    bits.push(t);
  }
  if (d.totalCalories != null) bits.push(`${formatNum(d.totalCalories)} cal total`);
  return bits.join(" · ");
}
