import type { ExerciseLibrary, ExerciseStat, Section } from "../../../shared/exercises/model";

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
