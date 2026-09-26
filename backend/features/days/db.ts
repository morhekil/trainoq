import type { DayDoc } from "../../../shared/days/model";
import type { Section } from "../../../shared/exercises/model";
import { isDayEmpty } from "../../../shared/days/model";
import { nameKey } from "../../../shared/exercises/model";

export interface StoredDay {
  date: string;
  doc: DayDoc;
  updatedAt: string;
}

interface LogRow {
  section: Section;
  name: string;
  detail: string;
}

function logRows(doc: DayDoc): LogRow[] {
  const rows: LogRow[] = [];
  for (const s of doc.sessions) {
    for (const it of s.warmup) if (it.name.trim()) rows.push({ section: "warmup", name: it.name.trim(), detail: JSON.stringify({ reps: it.reps }) });
    for (const b of s.main)
      for (const e of b.exercises)
        if (e.name.trim())
          rows.push({
            section: "main",
            name: e.name.trim(),
            detail: JSON.stringify({
              sets: e.sets.map((x) => ({ type: x.type, weight: x.weight, reps: x.reps })),
              superset: b.exercises.length > 1,
            }),
          });
    for (const it of s.cooldown) if (it.name.trim()) rows.push({ section: "cooldown", name: it.name.trim(), detail: JSON.stringify({ reps: it.reps }) });
  }
  return rows;
}

export async function getDay(db: D1Database, date: string): Promise<StoredDay | null> {
  const row = await db.prepare("SELECT date, doc, updated_at FROM days WHERE date = ?").bind(date).first<{ date: string; doc: string; updated_at: string }>();
  return row ? { date: row.date, doc: JSON.parse(row.doc), updatedAt: row.updated_at } : null;
}

export type PutResult = { ok: true; updatedAt: string | null } | { ok: false; current: StoredDay | null };

/**
 * Save a day. `base` is the updatedAt the client last saw from the server (null if it never saw one).
 * If the server copy has moved on since then, nothing is written and the current copy is returned.
 */
export async function putDay(db: D1Database, date: string, doc: DayDoc, base: string | null): Promise<PutResult> {
  const existing = await db.prepare("SELECT updated_at FROM days WHERE date = ?").bind(date).first<{ updated_at: string }>();
  if (existing && existing.updated_at !== base) {
    return { ok: false, current: await getDay(db, date) };
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
    ...logRows(doc).map((r, i) =>
      db
        .prepare("INSERT INTO exercise_log (date, section, name, name_key, detail, ord) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(date, r.section, r.name, nameKey(r.name), r.detail, i),
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
  return results.map((r) => ({ date: r.date, doc: JSON.parse(r.doc), updatedAt: r.updated_at }));
}
