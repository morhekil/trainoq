// Build the physio report page from a backup export (menu → Download backup (JSON), or `backup.export`).
//
//   npm run report:physio -- trainoq-export.json report.html 2026-09-22 [2026-10-08] [--period 2026-10-09..2026-10-12=Sick ...]
//
// The end date defaults to the export date. Each --period shades and labels its days, inclusive. Every value is shaped with the app's own formatters, so sets and
// effort read as they do in the day view; the page in scripts/physio_report.html does the charting.
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { activityHistory, activityName, activityTotals, type Activity } from "../shared/days/model";
import { formatDateShort } from "../shared/days/format";
import { inputDaySchema } from "../shared/days/schema";
import { clockTime } from "../shared/days/time";
import { orderedDayEvents } from "../shared/days/timeline";
import { seedExercise } from "../shared/exercises/catalog";
import { formatEffort, formatNum, formatSets, formatSetup } from "../shared/exercises/format";
import type { Effort, SessionExercise, SessionItem } from "../shared/exercises/model";
import { itemSets, minutesBetween } from "../shared/sessions/format";
import type { Session } from "../shared/sessions/model";

export interface Export { days: { date: string; doc: unknown }[]; catalog: { id: string; name: string }[] }
type Perf = { exerciseId: string; name: string; sets: string; effort: Effort | null; effortText: string; comment: string };
type SessionPart = {
  kind: "session"; start: string; end: string | null; minutes: number | null; calories: number | null; notes: string;
  sections: { title: string; items: { superset: boolean; perfs: Perf[] }[] }[];
};
type ActivityPart = {
  kind: "activity"; start: string; name: string; minutes: number | null; calories: number | null;
  effort: Effort | null; effortText: string; comment: string; breakdown: string;
};
export interface ReportDay {
  date: string; label: string; calories: number | null; period?: string;
  comments: { time: string; text: string; score?: { metric: string; value: number } }[];
  events: { time: string; title: string | null; notes: string; parts: (SessionPart | ActivityPart)[] }[];
}
export interface Report { from: string; to: string; generatedAt: string; days: ReportDay[] }
export interface Period { from: string; to: string; label: string }

const SECTIONS = [["warmup", "Warm-up"], ["main", "Main"], ["cooldown", "Cool-down"]] as const;

export function buildReport(data: Export, from: string, to: string, periods: Period[] = [], generatedAt = new Date().toISOString()): Report {
  const names = new Map(data.catalog.map((exercise) => [exercise.id, exercise.name]));
  const name = (id: string) => names.get(id) ?? seedExercise(id)?.name ?? id;
  const docs = new Map(data.days.map((day) => [day.date, day.doc]));

  const perf = (e: SessionExercise, sets: string): Perf => {
    const setup = formatSetup(e.setup, e.params);
    return { exerciseId: e.exerciseId, name: name(e.exerciseId), sets: [setup, sets].filter(Boolean).join(" · "),
      effort: e.effort ?? null, effortText: e.effort ? formatEffort(e.effort, e.params) : "", comment: e.comment.trim() };
  };
  const item = (i: SessionItem) => i.kind === "exercise"
    ? { superset: false, perfs: [perf(i, formatSets(i.sets, i.params))] }
    : { superset: true, perfs: i.members.map((m) => perf(m, formatSets(itemSets(i, m.id), m.params))) };
  const session = (s: Session): SessionPart => ({
    kind: "session", start: clockTime(s.startedAt), end: s.endedAt && clockTime(s.endedAt),
    minutes: s.endedAt ? minutesBetween(s.startedAt, s.endedAt) : null, calories: s.calories, notes: s.notes.trim(),
    sections: SECTIONS.filter(([key]) => s[key].length).map(([key, title]) => ({ title, items: s[key].map(item) })),
  });
  const activity = (a: Activity): ActivityPart => ({
    kind: "activity", start: clockTime(a.segments[0].startedAt), name: activityName(a, name), ...activityTotals(a),
    effort: a.effort ?? null, effortText: a.effort ? formatEffort(a.effort) : "", comment: a.comment.trim(),
    breakdown: activityHistory(a).filter((h) => h.segments)
      .map((h) => `${h.segments}× ${name(h.exerciseId)}${h.result.minutes != null ? ` ${formatNum(h.result.minutes)} min` : ""}`).join(", "),
  });

  const days: ReportDay[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    const date = new Date(t).toISOString().slice(0, 10);
    const doc = docs.has(date) ? inputDaySchema.parse(docs.get(date)) : null;
    const timeline = doc ? orderedDayEvents(doc) : [];
    const period = periods.find((p) => p.from <= date && date <= p.to);
    days.push({
      date, label: formatDateShort(date), calories: doc?.totalCalories ?? null, ...(period && { period: period.label }),
      comments: timeline.flatMap((r) => r.kind === "comment" ? [{ time: r.time, text: r.comment.text.trim(), ...(r.comment.score && { score: r.comment.score }) }] : []),
      events: timeline.flatMap((r) => r.kind === "event" ? [{ time: r.time, title: r.event.title, notes: r.event.notes.trim(),
        parts: r.event.entries.map((e) => e.kind === "session" ? session(e.session) : activity(e.activity)) }] : []),
    });
  }
  return { from, to, generatedAt, days };
}

/** `<` is escaped so a comment containing "</script>" stays inside the JSON block. */
export const renderReport = (template: string, report: Report) =>
  template.replace("/*REPORT*/", () => JSON.stringify(report).replace(/</g, "\\u003c"));

if (process.argv[1]?.endsWith("physio_report.mjs")) {
  const { positionals: [file, out, from, to], values } = parseArgs({ allowPositionals: true, options: { period: { type: "string", multiple: true } } });
  if (!file || !out || !from) throw new Error("Usage: npm run report:physio -- <export.json> <out.html> <from YYYY-MM-DD> [to YYYY-MM-DD] [--period FROM..TO=Label ...]");
  const periods = (values.period ?? []).map((arg) => {
    const m = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})=(.+)$/.exec(arg);
    if (!m) throw new Error(`--period expects FROM..TO=Label, such as 2026-10-09..2026-10-12=Sick; got "${arg}"`);
    return { from: m[1], to: m[2], label: m[3] };
  });
  const data = JSON.parse(readFileSync(file, "utf8")) as Export & { exportedAt: string };
  const template = readFileSync("scripts/physio_report.html", "utf8");
  writeFileSync(out, renderReport(template, buildReport(data, from, to ?? new Date(data.exportedAt).toLocaleDateString("en-CA"), periods)));
}
