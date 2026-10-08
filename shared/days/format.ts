import { activityName, activityTotals, type Activity, type DayDoc } from "./model";
import { countExercises, sessionLines } from "../sessions/format";
import { formatEffort, formatNum } from "../exercises/format";
import { seedExercise } from "../exercises/catalog";
import { activityTime, orderedDayEvents } from "./timeline";
import { formatTime } from "./time";

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

const seedName = (id: string) => seedExercise(id)?.name ?? id;

/** Plain-text summary of a day, for sending to a PT or physio. */
export function dayToText(d: DayDoc, name: (id: string) => string = seedName): string {
  const out: string[] = [formatDateLong(d.date)];
  const activityLine = (a: Activity) => {
    const bits = [activityName(a, name)];
    const totals = activityTotals(a);
    if (totals.minutes != null) bits.push(`${formatNum(totals.minutes)} min`);
    if (totals.calories != null) bits.push(`${formatNum(totals.calories)} cal`);
    if (a.effort) bits.push(formatEffort(a.effort));
    return `- ${activityTime(a)} ${bits.join(" · ")}${a.comment.trim() ? ` – ${a.comment.trim()}` : ""}`;
  };
  let inActivities = false;
  for (const record of orderedDayEvents(d)) {
    if (record.kind === "comment") {
      out.push("", `Comment ${record.time}`, record.comment.text.trim());
      inActivities = false;
    } else if (record.event.entries.length > 1 || record.event.title || record.event.notes) {
      const event = record.event;
      out.push("", "----", `${event.title?.trim() || "Training event"} (${event.entries.length} ${event.entries.length === 1 ? "part" : "parts"})`);
      if (event.notes.trim()) out.push(event.notes.trim());
      for (const entry of event.entries) {
        if (entry.kind === "session") out.push("", ...sessionLines(entry.session, name));
        else out.push(activityLine(entry.activity));
      }
      inActivities = false;
    } else {
      const entry = record.event.entries[0];
      if (entry.kind === "session") {
        out.push("", "----", ...sessionLines(entry.session, name));
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
export function daySummary(d: DayDoc, resolveName: (id: string) => string = seedName): string {
  const bits: string[] = [];
  for (const record of orderedDayEvents(d)) {
    if (record.kind === "comment") continue;
    const event = record.event;
    if (event.entries.length > 1 || event.title || event.notes) {
      bits.push(`${event.title?.trim() || "Training event"} (${event.entries.length} ${event.entries.length === 1 ? "part" : "parts"})`);
      continue;
    }
    const entry = event.entries[0];
    if (entry.kind === "activity") {
      bits.push(activityName(entry.activity, resolveName));
      continue;
    }
    const s = entry.session;
    let t = `Session ${formatTime(s.startedAt)} · ${countExercises(s)} exercises`;
    if (s.calories != null) t += ` · ${formatNum(s.calories)} cal`;
    bits.push(t);
  }
  if (d.totalCalories != null) bits.push(`${formatNum(d.totalCalories)} cal total`);
  return bits.join(" · ");
}
