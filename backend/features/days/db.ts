import { dayActivities, daySessions, type DayDoc } from "../../../shared/days/model";
import type { ExerciseContext } from "../../../shared/exercises/model";
import { isDayEmpty } from "../../../shared/days/model";
import { nameKey } from "../../../shared/exercises/model";
import { exerciseIdForName, seedExercise } from "../../../shared/exercises/catalog";
import { itemSets } from "../../../shared/sessions/format";
import { TRPCError } from "@trpc/server";
import { createExercise } from "../exercises/db";
import { inputDaySchema } from "../../../shared/days/schema";

export interface StoredDay {
  date: string;
  doc: DayDoc;
  updatedAt: string;
}

interface LogRow {
  section: ExerciseContext;
  exerciseId: string;
  name: string;
  detail: string;
}

function logRows(doc: DayDoc): LogRow[] {
  const rows: LogRow[] = [];
  for (const s of daySessions(doc)) {
    for (const section of ["warmup", "main", "cooldown"] as const)
      for (const item of s[section])
        for (const e of item.kind === "exercise" ? [item] : item.members)
          rows.push({
            section, exerciseId: e.exerciseId, name: seedExercise(e.exerciseId)?.name ?? "",
            detail: JSON.stringify({ params: e.params, ...(e.setup ? { setup: e.setup } : {}), sets: itemSets(item, e.id).map(({ id: _id, ...set }) => set), superset: item.kind === "superset" }),
          });
  }
  for (const activity of dayActivities(doc))
    rows.push({
      section: "activity", exerciseId: activity.exerciseId, name: seedExercise(activity.exerciseId)?.name ?? "",
      detail: JSON.stringify(activity.result),
    });
  return rows;
}

function garminLinks(doc: DayDoc): { key: string; kind: string; id: string | null }[] {
  return [
    ...daySessions(doc).filter((s) => s.garminSourceKey).map((s) => ({ key: s.garminSourceKey!, kind: "session", id: s.id })),
    ...dayActivities(doc).filter((a) => a.garminSourceKey).map((a) => ({ key: a.garminSourceKey!, kind: "activity", id: a.id })),
    ...doc.ignoredGarminSourceKeys.map((key) => ({ key, kind: "ignored", id: null })),
  ];
}

export async function getDay(db: D1Database, date: string): Promise<StoredDay | null> {
  const row = await db.prepare("SELECT date, doc, updated_at FROM days WHERE date = ?").bind(date).first<{ date: string; doc: string; updated_at: string }>();
  return row ? { date: row.date, doc: inputDaySchema.parse(JSON.parse(row.doc)), updatedAt: row.updated_at } : null;
}

export type PutResult = { ok: true; updatedAt: string | null } | { ok: false; current: StoredDay | null };

/**
 * Save a day. `base` is the updatedAt the client last saw from the server (null if it never saw one).
 * If the server copy has moved on since then, nothing is written and the current copy is returned.
 */
export async function putDay(db: D1Database, date: string, doc: DayDoc, base: string | null, sourceVersion = 8, legacyNames: string[] = []): Promise<PutResult> {
  const links = garminLinks(doc);
  if (new Set(links.map((link) => link.key)).size !== links.length)
    throw new TRPCError({ code: "BAD_REQUEST", message: "Garmin source is used more than once" });
  const existing = await db.prepare("SELECT updated_at, doc FROM days WHERE date = ?").bind(date).first<{ updated_at: string; doc: string }>();
  if (sourceVersion < 8 && existing && JSON.parse(existing.doc).v >= 8)
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Refresh this client before saving a newer day" });
  if (existing && existing.updated_at !== base) {
    return { ok: false, current: await getDay(db, date) };
  }
  for (const name of legacyNames) {
    const id = exerciseIdForName(name);
    if (!seedExercise(id)) await createExercise(db, { id, name });
  }
  const rows = logRows(doc);
  const customIds = [...new Set(rows.map((row) => row.exerciseId).filter((id) => !seedExercise(id)))];
  if (customIds.length) {
    const found = await db.prepare(`SELECT id, name FROM exercise_catalog WHERE id IN (${customIds.map(() => "?").join(",")})`).bind(...customIds).all<{ id: string; name: string }>();
    if (found.results.length !== customIds.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Create custom exercises before saving the day" });
    const names = new Map(found.results.map((item) => [item.id, item.name]));
    rows.forEach((row) => { row.name = names.get(row.exerciseId) ?? row.name; });
  }
  if (isDayEmpty(doc)) {
    const [deleted] = await db.batch([
      db.prepare("DELETE FROM days WHERE date = ? AND updated_at = ?").bind(date, base),
      db.prepare("DELETE FROM exercise_log WHERE date = ? AND NOT EXISTS (SELECT 1 FROM days WHERE date = ?)").bind(date, date),
      db.prepare("DELETE FROM garmin_links WHERE date = ? AND NOT EXISTS (SELECT 1 FROM days WHERE date = ?)").bind(date, date),
    ]);
    if (!deleted.meta.changes && (base || await getDay(db, date))) return { ok: false, current: await getDay(db, date) };
    return { ok: true, updatedAt: null };
  }
  const updatedAt = `${new Date().toISOString()}:${crypto.randomUUID()}`;
  const stmts = [
    db
      .prepare("INSERT INTO days (date, doc, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(date) DO UPDATE SET doc = excluded.doc, updated_at = excluded.updated_at WHERE days.updated_at = ?4")
      .bind(date, JSON.stringify(doc), updatedAt, base),
    db.prepare("DELETE FROM exercise_log WHERE date = ? AND EXISTS (SELECT 1 FROM days WHERE date = ? AND updated_at = ?)").bind(date, date, updatedAt),
    db.prepare("DELETE FROM garmin_links WHERE date = ? AND EXISTS (SELECT 1 FROM days WHERE date = ? AND updated_at = ?)").bind(date, date, updatedAt),
    ...links.map((link) => db.prepare("INSERT INTO garmin_links (source_key, date, target_kind, target_id) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM days WHERE date = ? AND updated_at = ?)").bind(link.key, date, link.kind, link.id, date, updatedAt)),
    ...rows.map((r, i) =>
      db
        .prepare("INSERT INTO exercise_log (date, section, name, name_key, detail, ord, exercise_id) SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM days WHERE date = ? AND updated_at = ?)")
        .bind(date, r.section, r.name, nameKey(r.name), r.detail, i, r.exerciseId, date, updatedAt),
    ),
  ];
  let saved: D1Result;
  try { [saved] = await db.batch(stmts); }
  catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed: garmin_links\.source_key/.test(error.message))
      throw new TRPCError({ code: "BAD_REQUEST", message: "Garmin activity is already linked on another day. Refresh the Garmin review." });
    throw error;
  }
  if (!saved.meta.changes) return { ok: false, current: await getDay(db, date) };
  return { ok: true, updatedAt };
}

export async function listDays(db: D1Database, opts: { before?: string; limit: number; withSessions: boolean }): Promise<StoredDay[]> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (opts.before) {
    where.push("date < ?");
    binds.push(opts.before);
  }
  if (opts.withSessions) where.push("(json_array_length(doc, '$.sessions') > 0 OR EXISTS (SELECT 1 FROM json_each(days.doc, '$.events') AS event, json_each(event.value, '$.entries') AS entry WHERE json_extract(entry.value, '$.kind') = 'session'))");
  const sql = `SELECT date, doc, updated_at FROM days ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY date DESC LIMIT ?`;
  const { results } = await db
    .prepare(sql)
    .bind(...binds, opts.limit)
    .all<{ date: string; doc: string; updated_at: string }>();
  return results.map((r) => ({ date: r.date, doc: inputDaySchema.parse(JSON.parse(r.doc)), updatedAt: r.updated_at }));
}
