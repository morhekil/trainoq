import type { ExerciseLibrary, ExerciseStat, Section } from "../../../shared/exercises/model";
import { migrateLegacyItem } from "../../../shared/days/migrate";

export async function exerciseLibrary(db: D1Database): Promise<ExerciseLibrary> {
  const [statsRes, histRes] = await db.batch([
    // bare `name` takes the value from the row holding MAX(date), i.e. the latest spelling
    db.prepare("SELECT name_key, name, section, COUNT(*) AS c, MAX(date) AS last FROM exercise_log GROUP BY name_key, section"),
    db.prepare(
      `SELECT name_key, date, section, detail FROM (
         SELECT name_key, date, section, detail, ROW_NUMBER() OVER (PARTITION BY name_key, section ORDER BY date DESC, ord ASC) AS rn
         FROM exercise_log
       ) WHERE rn <= 4 ORDER BY name_key, section, date DESC`,
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
  for (const r of histRes.results as { name_key: string; date: string; section: Section; detail: string }[]) {
    const detail = JSON.parse(r.detail) as { sets?: ExerciseLibrary["history"][string][number]["sets"]; reps?: string };
    const sets = detail.sets ?? migrateLegacyItem({ id: "legacy-log", name: r.name_key, reps: detail.reps ?? "", comment: "" }).exercises[0].sets;
    (history[r.name_key] ??= []).push({ date: r.date, section: r.section, sets: sets.map(({ type, weight, reps }) => ({ type, weight, reps })) });
  }
  return { stats: [...stats.values()], history };
}
