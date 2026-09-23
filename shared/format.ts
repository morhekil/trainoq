import type { Block, DayDoc, Session, SetType, SimpleItem, WorkSet } from "./types";

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
export function formatTime(iso: string, timeZone?: string): string {
  const s = new Intl.DateTimeFormat("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  }).format(new Date(iso));
  return s.replace(/\s/g, "").toLowerCase();
}

export function minutesBetween(a: string, b: string): number {
  return Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000));
}

export function formatNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

export function formatSet(s: Pick<WorkSet, "weight" | "reps">): string {
  const w = s.weight == null ? "" : s.weight === 0 ? "BW" : `${formatNum(s.weight)}kg`;
  const r = s.reps == null ? "" : `×${s.reps}`;
  return w + r || "–";
}

const TYPE_LABEL: Record<SetType, string> = { warmup: "warm-up", working: "working", backoff: "back-off" };

/** "warm-up BW×6, 5kg×5 | working 10kg×5 ×3 | back-off BW×9" */
export function formatSets(sets: Pick<WorkSet, "type" | "weight" | "reps">[]): string {
  const filled = sets.filter((s) => s.weight != null || s.reps != null);
  if (filled.length === 0) return "";
  // split into runs of the same type, then group identical consecutive sets
  const runs: { type: SetType; parts: string[] }[] = [];
  let i = 0;
  while (i < filled.length) {
    const s = filled[i];
    let n = 1;
    while (
      i + n < filled.length &&
      filled[i + n].type === s.type &&
      filled[i + n].weight === s.weight &&
      filled[i + n].reps === s.reps
    )
      n++;
    const part = formatSet(s) + (n > 1 ? ` ×${n}` : "");
    const last = runs[runs.length - 1];
    if (last && last.type === s.type) last.parts.push(part);
    else runs.push({ type: s.type, parts: [part] });
    i += n;
  }
  const onlyWorking = runs.length === 1 && runs[0].type === "working";
  if (onlyWorking) return runs[0].parts.join(", ");
  return runs.map((r) => `${TYPE_LABEL[r.type]} ${r.parts.join(", ")}`).join(" | ");
}

function simpleLine(it: SimpleItem): string | null {
  const name = it.name.trim();
  if (!name) return null;
  const reps = it.reps.trim();
  const repsText = reps ? (/^\d+$/.test(reps) ? ` ×${reps}` : ` ${reps}`) : "";
  const comment = it.comment.trim() ? ` – ${it.comment.trim()}` : "";
  return `- ${name}${repsText}${comment}`;
}

function blockLines(b: Block): string[] {
  const exs = b.exercises.filter((e) => e.name.trim() || e.sets.length);
  if (exs.length === 0) return [];
  const lines: string[] = [];
  if (exs.length === 1) {
    const e = exs[0];
    const sets = formatSets(e.sets);
    lines.push(`${e.name.trim() || "Exercise"}${sets ? `: ${sets}` : ""}`);
    if (e.comment.trim()) lines.push(`  – ${e.comment.trim()}`);
    return lines;
  }
  lines.push(`Superset: ${exs.map((e) => e.name.trim() || "Exercise").join(" / ")}`);
  for (const e of exs) {
    const sets = formatSets(e.sets);
    lines.push(`- ${e.name.trim() || "Exercise"}${sets ? `: ${sets}` : ""}`);
    if (e.comment.trim()) lines.push(`  – ${e.comment.trim()}`);
  }
  return lines;
}

export function sessionHeading(s: Session, timeZone?: string): string {
  let h = `Session ${formatTime(s.startedAt, timeZone)}`;
  if (s.endedAt) h += `–${formatTime(s.endedAt, timeZone)} (${minutesBetween(s.startedAt, s.endedAt)} min)`;
  if (s.calories != null) h += ` · ${formatNum(s.calories)} active cal`;
  return h;
}

export function sessionLines(s: Session, timeZone?: string): string[] {
  const out: string[] = [sessionHeading(s, timeZone)];
  const warm = s.warmup.map(simpleLine).filter(Boolean) as string[];
  if (warm.length) out.push("", "Warm-up", ...warm);
  const main = s.main.map(blockLines).filter((l) => l.length);
  if (main.length) {
    out.push("", "Main");
    main.forEach((l, i) => {
      if (i > 0 && (l.length > 1 || main[i - 1].length > 1)) out.push("");
      out.push(...l);
    });
  }
  const cool = s.cooldown.map(simpleLine).filter(Boolean) as string[];
  if (cool.length) out.push("", "Cool-down", ...cool);
  if (s.notes.trim()) out.push("", `Notes: ${s.notes.trim()}`);
  return out;
}

/** Plain-text summary of a day, for sending to a PT or physio. */
export function dayToText(d: DayDoc, timeZone?: string): string {
  const out: string[] = [formatDateLong(d.date)];
  if (d.morning.trim()) out.push("", "Morning", d.morning.trim());
  for (const s of d.sessions) out.push("", "----", ...sessionLines(s, timeZone));
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

export function countExercises(s: Session): number {
  return (
    s.warmup.filter((x) => x.name.trim()).length +
    s.main.reduce((n, b) => n + b.exercises.filter((e) => e.name.trim()).length, 0) +
    s.cooldown.filter((x) => x.name.trim()).length
  );
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
