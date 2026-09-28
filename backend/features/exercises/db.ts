import { SEED_EXERCISES, exerciseIdForName } from "../../../shared/exercises/catalog";
import { nameKey, type ActivityResult, type ExerciseContext, type ExerciseLibrary, type ExerciseStat, type WorkSet } from "../../../shared/exercises/model";
import { migrateLegacyItem } from "../../../shared/days/migrate";

export async function catalog(db: D1Database): Promise<ExerciseLibrary["catalog"]> {
  const { results } = await db.prepare("SELECT id, name FROM exercise_catalog ORDER BY name").all<{ id: string; name: string }>();
  return [
    ...SEED_EXERCISES.map(({ id, name, section, aliases }) => ({ id, name, section, aliases })),
    ...results.filter((r) => !SEED_EXERCISES.some((seed) => seed.id === exerciseIdForName(r.name))).map(({ id, name }) => ({ id, name, section: null, aliases: "" })),
  ];
}

export async function createExercise(db: D1Database, input: { id: string; name: string }): Promise<{ id: string; name: string }> {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name) throw new Error("Exercise name is required");
  await db.prepare("INSERT OR IGNORE INTO exercise_catalog (id, name, name_key) VALUES (?, ?, ?)").bind(input.id, name, nameKey(name)).run();
  const stored = await db.prepare("SELECT id, name FROM exercise_catalog WHERE id = ?").bind(input.id).first<{ id: string; name: string }>();
  if (!stored || nameKey(stored.name) !== nameKey(name)) throw new Error("Exercise ID belongs to a different name");
  return stored;
}

export async function exerciseLibrary(db: D1Database): Promise<ExerciseLibrary> {
  const [statsRes, histRes] = await db.batch([
    db.prepare("SELECT exercise_id, name_key, name, section, COUNT(*) AS c, MAX(date) AS last FROM exercise_log GROUP BY exercise_id, name_key, section"),
    db.prepare(`SELECT exercise_id, name_key, name, date, section, detail FROM (
      SELECT exercise_id, name_key, name, date, section, detail,
        ROW_NUMBER() OVER (PARTITION BY exercise_id, name_key, section ORDER BY date DESC, ord ASC) AS rn
      FROM exercise_log
    ) WHERE rn <= 4 ORDER BY exercise_id, section, date DESC`),
  ]);
  const stats = new Map<string, ExerciseStat>();
  for (const r of statsRes.results as { exercise_id: string | null; name: string; section: ExerciseContext; c: number; last: string }[]) {
    const id = r.exercise_id?.startsWith("legacy:") ? exerciseIdForName(r.name) : r.exercise_id ?? exerciseIdForName(r.name);
    let stat = stats.get(id);
    if (!stat) stats.set(id, (stat = { exerciseId: id, count: 0, last: r.last, sections: {} }));
    stat.count += r.c;
    stat.sections[r.section] = (stat.sections[r.section] ?? 0) + r.c;
    if (r.last > stat.last) stat.last = r.last;
  }
  const history: ExerciseLibrary["history"] = {};
  for (const r of histRes.results as { exercise_id: string | null; name: string; date: string; section: ExerciseContext; detail: string }[]) {
    const id = r.exercise_id?.startsWith("legacy:") ? exerciseIdForName(r.name) : r.exercise_id ?? exerciseIdForName(r.name);
    if (r.section === "activity") {
      (history[id] ??= []).push({ date: r.date, section: "activity", result: JSON.parse(r.detail) as ActivityResult });
    } else {
      const detail = JSON.parse(r.detail) as { sets?: Pick<WorkSet, "type" | "weight" | "reps">[]; reps?: string };
      const sets = detail.sets ?? migrateLegacyItem({ id: "legacy-log", name: r.name, reps: detail.reps ?? "", comment: "" }).exercises[0].sets;
      (history[id] ??= []).push({ date: r.date, section: r.section, sets: sets.map(({ type, weight, reps }) => ({ type, weight, reps })) });
    }
  }
  // Old name-based and current IDs can resolve to the same exercise after SQL's per-ID limit.
  for (const [id, entries] of Object.entries(history)) {
    const counts: Partial<Record<ExerciseContext, number>> = {};
    history[id] = entries.sort((a, b) => b.date.localeCompare(a.date)).filter((entry) =>
      (counts[entry.section] = (counts[entry.section] ?? 0) + 1) <= 4);
  }
  return { catalog: await catalog(db), stats: [...stats.values()], history };
}
