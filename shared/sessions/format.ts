import type { Block, SimpleItem } from "../exercises/model";
import { formatNum, formatSets } from "../exercises/format";
import type { Session } from "./model";

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

export function countExercises(s: Session): number {
  return (
    s.warmup.filter((x) => x.name.trim()).length +
    s.main.reduce((n, b) => n + b.exercises.filter((e) => e.name.trim()).length, 0) +
    s.cooldown.filter((x) => x.name.trim()).length
  );
}
