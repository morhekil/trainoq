import type { DayDoc, ExerciseLibrary, ExerciseStat, Section } from "../shared/types";
import { isDayEmpty, nameKey } from "../shared/types";

export interface StoredDay {
  date: string;
  doc: DayDoc;
  updatedAt: string;
}

/** Light structural check so a bad client can't store junk. Returns an error message or null. */
export function validateDay(doc: unknown, date: string): string | null {
  if (!doc || typeof doc !== "object") return "doc must be an object";
  const d = doc as Record<string, unknown>;
  if (d.date !== date) return "doc.date does not match URL";
  if (typeof d.morning !== "string" || typeof d.notes !== "string") return "morning/notes must be strings";
  if (!Array.isArray(d.sessions) || !Array.isArray(d.activities)) return "sessions/activities must be arrays";
  for (const s of d.sessions as Record<string, unknown>[]) {
    if (!s || typeof s !== "object") return "bad session";
    if (typeof s.startedAt !== "string") return "session.startedAt must be a string";
    if (!Array.isArray(s.warmup) || !Array.isArray(s.main) || !Array.isArray(s.cooldown)) return "bad session sections";
    for (const b of s.main as Record<string, unknown>[]) {
      if (!b || !Array.isArray(b.exercises)) return "bad block";
      for (const e of b.exercises as Record<string, unknown>[]) {
        if (!e || typeof e.name !== "string" || !Array.isArray(e.sets)) return "bad exercise";
      }
    }
    for (const it of [...(s.warmup as unknown[]), ...(s.cooldown as unknown[])] as Record<string, unknown>[]) {
      if (!it || typeof it.name !== "string") return "bad warm-up/cool-down item";
    }
  }
  return null;
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

export async function exerciseLibrary(db: D1Database): Promise<ExerciseLibrary> {
  const [statsRes, histRes] = await db.batch([
    // bare `name` takes the value from the row holding MAX(date), i.e. the latest spelling
    db.prepare("SELECT name_key, name, section, COUNT(*) AS c, MAX(date) AS last FROM exercise_log GROUP BY name_key, section"),
    db.prepare(
      `SELECT name_key, date, detail FROM (
         SELECT name_key, date, detail, ROW_NUMBER() OVER (PARTITION BY name_key ORDER BY date DESC, ord ASC) AS rn
         FROM exercise_log WHERE section = 'main'
       ) WHERE rn <= 4 ORDER BY name_key, date DESC`,
    ),
  ]);
  const stats = new Map<string, ExerciseStat>();
  for (const r of statsRes.results as { name_key: string; name: string; section: Section; c: number; last: string }[]) {
    let s = stats.get(r.name_key);
    if (!s) stats.set(r.name_key, (s = { name: r.name, count: 0, last: r.last, sections: {} }));
    s.count += r.c;
    s.sections[r.section] = r.c;
    if (r.last > s.last) {
      s.last = r.last;
      s.name = r.name;
    }
  }
  const history: ExerciseLibrary["history"] = {};
  for (const r of histRes.results as { name_key: string; date: string; detail: string }[]) {
    (history[r.name_key] ??= []).push({ date: r.date, sets: JSON.parse(r.detail).sets ?? [] });
  }
  return { stats: [...stats.values()], history };
}

export async function exportAll(db: D1Database): Promise<StoredDay[]> {
  const { results } = await db.prepare("SELECT date, doc, updated_at FROM days ORDER BY date").all<{ date: string; doc: string; updated_at: string }>();
  return results.map((r) => ({ date: r.date, doc: JSON.parse(r.doc), updatedAt: r.updated_at }));
}
