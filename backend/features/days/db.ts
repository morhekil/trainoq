import type { DayDoc } from "../../../shared/days/model";
import type { Section } from "../../../shared/exercises/model";
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
  section: Section;
  exerciseId: string;
  name: string;
  detail: string;
}

function logRows(doc: DayDoc): LogRow[] {
  const rows: LogRow[] = [];
  for (const s of doc.sessions) {
    for (const section of ["warmup", "main", "cooldown"] as const)
      for (const item of s[section])
        for (const e of item.kind === "exercise" ? [item] : item.members)
          rows.push({
            section, exerciseId: e.exerciseId, name: seedExercise(e.exerciseId)?.name ?? "",
            detail: JSON.stringify({ sets: itemSets(item, e.id).map(({ type, weight, reps }) => ({ type, weight, reps })), superset: item.kind === "superset" }),
          });
  }
  return rows;
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
export async function putDay(db: D1Database, date: string, doc: DayDoc, base: string | null, sourceVersion = 3, legacyNames: string[] = []): Promise<PutResult> {
  const existing = await db.prepare("SELECT updated_at, doc FROM days WHERE date = ?").bind(date).first<{ updated_at: string; doc: string }>();
  if (sourceVersion < 3 && existing && JSON.parse(existing.doc).v === 3)
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
    await db.batch([db.prepare("DELETE FROM days WHERE date = ?").bind(date), db.prepare("DELETE FROM exercise_log WHERE date = ?").bind(date)]);
    return { ok: true, updatedAt: null };
  }
  const updatedAt = new Date().toISOString();
  const stmts = [
    db
      .prepare("INSERT INTO days (date, doc, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(date) DO UPDATE SET doc = ?2, updated_at = ?3")
      .bind(date, JSON.stringify(doc), updatedAt),
    db.prepare("DELETE FROM exercise_log WHERE date = ?").bind(date),
    ...rows.map((r, i) =>
      db
        .prepare("INSERT INTO exercise_log (date, section, name, name_key, detail, ord, exercise_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(date, r.section, r.name, nameKey(r.name), r.detail, i, r.exerciseId),
    ),
  ];
  await db.batch(stmts);
  return { ok: true, updatedAt };
}

export async function listDays(db: D1Database, opts: { before?: string; limit: number; withSessions: boolean }): Promise<StoredDay[]> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (opts.before) {
    where.push("date < ?");
    binds.push(opts.before);
  }
  if (opts.withSessions) where.push("json_array_length(doc, '$.sessions') > 0");
  const sql = `SELECT date, doc, updated_at FROM days ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY date DESC LIMIT ?`;
  const { results } = await db
    .prepare(sql)
    .bind(...binds, opts.limit)
    .all<{ date: string; doc: string; updated_at: string }>();
  return results.map((r) => ({ date: r.date, doc: inputDaySchema.parse(JSON.parse(r.doc)), updatedAt: r.updated_at }));
}
