import type { DayDoc } from "./model";
import { countExercises, formatTime, sessionLines } from "../sessions/format";
import { formatNum } from "../exercises/format";

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
  const out: string[] = [formatDateLong(d.date)];
  if (d.morning.trim()) out.push("", "Morning", d.morning.trim());
  for (const s of d.sessions) out.push("", "----", ...sessionLines(s, timeZone, resolveName));
  const acts = d.activities.filter((a) => a.name.trim() || a.minutes != null || a.calories != null);
  if (acts.length) {
    out.push("", "----", "Activities");
    for (const a of acts) {
      const bits = [a.name.trim() || "Activity"];
      if (a.minutes != null) bits.push(`${formatNum(a.minutes)} min`);
      if (a.calories != null) bits.push(`${formatNum(a.calories)} cal`);
      out.push(`- ${bits.join(" · ")}${a.notes.trim() ? ` – ${a.notes.trim()}` : ""}`);
    }
  }
  if (d.totalCalories != null || d.notes.trim()) out.push("", "----");
  if (d.totalCalories != null) out.push(`Total daily active calories: ${formatNum(d.totalCalories)}`);
  if (d.notes.trim()) out.push(`Notes: ${d.notes.trim()}`);
  return out.join("\n");
}

/** One-line summary for the history list. */
export function daySummary(d: DayDoc, timeZone?: string): string {
  const bits: string[] = [];
  for (const s of d.sessions) {
    let t = `Session ${formatTime(s.startedAt, timeZone)} · ${countExercises(s)} exercises`;
    if (s.calories != null) t += ` · ${formatNum(s.calories)} cal`;
    bits.push(t);
  }
  for (const a of d.activities) if (a.name.trim()) bits.push(a.name.trim());
  if (d.totalCalories != null) bits.push(`${formatNum(d.totalCalories)} cal total`);
  return bits.join(" · ");
}
