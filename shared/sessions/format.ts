import type { Section, SessionItem, WorkSet } from "../exercises/model";
import { seedExercise } from "../exercises/catalog";
import { formatNum, formatSets, formatSetup } from "../exercises/format";
import { DEFAULT_PARAMS, valuesOf } from "../exercises/params";
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

export function itemSets(item: SessionItem, memberId?: string): WorkSet[] {
  if (item.kind === "exercise") return item.sets;
  const params = item.members.find((member) => member.id === memberId)?.params ?? DEFAULT_PARAMS;
  return item.rounds.map((round) => {
    const result = item.results.find((r) => r.memberId === memberId && r.roundId === round.id);
    return { ...round, ...valuesOf(result, params) };
  });
}

function itemLines(item: SessionItem, resolveName: (id: string) => string): string[] {
  const exs = item.kind === "exercise" ? [item] : item.members;
  if (item.kind === "superset" && exs.length === 0) return ["Superset (empty)"];
  const lines: string[] = [];
  if (item.kind === "exercise") {
    const e = exs[0];
    const sets = formatSets(item.sets, e.params);
    const setup = formatSetup(e.setup, e.params);
    lines.push(`${resolveName(e.exerciseId)}${setup ? ` (${setup})` : ""}${sets ? `: ${sets}` : ""}`);
    if (e.comment.trim()) lines.push(`  – ${e.comment.trim()}`);
    return lines;
  }
  lines.push(`Superset: ${exs.map((e) => resolveName(e.exerciseId)).join(" / ")}`);
  for (const e of exs) {
    const sets = formatSets(itemSets(item, e.id), e.params);
    const setup = formatSetup(e.setup, e.params);
    lines.push(`- ${resolveName(e.exerciseId)}${setup ? ` (${setup})` : ""}${sets ? `: ${sets}` : ""}`);
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

export function sessionLines(s: Session, timeZone?: string, resolveName: (id: string) => string = (id) => seedExercise(id)?.name ?? id): string[] {
  const out: string[] = [sessionHeading(s, timeZone)];
  for (const [section, title] of [["warmup", "Warm-up"], ["main", "Main"], ["cooldown", "Cool-down"]] as const) {
    const blocks = s[section].map((item) => itemLines(item, resolveName)).filter((l) => l.length);
    if (!blocks.length) continue;
    out.push("", title);
    blocks.forEach((l, i) => {
      if (i > 0 && (l.length > 1 || blocks[i - 1].length > 1)) out.push("");
      out.push(...l);
    });
  }
  if (s.notes.trim()) out.push("", `Notes: ${s.notes.trim()}`);
  return out;
}

export function countExercises(s: Session): number {
  const sections: Section[] = ["warmup", "main", "cooldown"];
  return sections.reduce((n, section) => n + s[section].reduce((m, item) => m + (item.kind === "exercise" ? 1 : item.members.length), 0), 0);
}
