import { SEED_EXERCISES, exerciseIdForName, seedExercise } from "../../../shared/exercises/catalog";
import { nameKey, type ActivityResult, type ExerciseContext, type ExerciseHistoryEntry, type ExerciseLibrary, type ExerciseStat, type WorkSet } from "../../../shared/exercises/model";
import { migrateLegacyItem } from "../../../shared/days/migrate";
import { DEFAULT_PARAMS, normalizeParams, valuesOf, type ParamSet, type ParamValues } from "../../../shared/exercises/params";
import { SEED_PARAMS } from "../../../shared/exercises/seed";
import { TRPCError } from "@trpc/server";

type LogHistoryRow = { name: string; date: string; section: ExerciseContext; detail: string };
function historyEntry(row: LogHistoryRow): ExerciseHistoryEntry {
  if (row.section === "activity") return { date: row.date, section: "activity", result: JSON.parse(row.detail) as ActivityResult };
  const detail = JSON.parse(row.detail) as { params?: ParamSet; setup?: ParamValues; sets?: (Pick<WorkSet, "type"> & ParamValues)[]; reps?: string };
  const params = detail.params ?? DEFAULT_PARAMS;
  const sets = detail.sets ?? migrateLegacyItem({ id: "legacy-log", name: row.name, reps: detail.reps ?? "", comment: "" }).exercises[0].sets;
  return { date: row.date, section: row.section, params, ...(detail.setup ? { setup: detail.setup } : {}), sets: sets.map(({ type, ...values }) => ({ type, ...valuesOf(values, params) })) };
}

export async function setExerciseParams(db: D1Database, input: { exerciseId: string; params: ParamSet; updatedAt: string }) {
  if (!seedExercise(input.exerciseId) && !(await db.prepare("SELECT id FROM exercise_catalog WHERE id = ?").bind(input.exerciseId).first()))
    throw new TRPCError({ code: "BAD_REQUEST", message: "Create the exercise before setting its parameters" });
  const updatedAt = new Date(input.updatedAt).toISOString();
  await db.prepare(`INSERT INTO exercise_params (exercise_id, params, updated_at) VALUES (?1, ?2, ?3)
    ON CONFLICT(exercise_id) DO UPDATE SET params = excluded.params, updated_at = excluded.updated_at
    WHERE excluded.updated_at > exercise_params.updated_at`)
    .bind(input.exerciseId, JSON.stringify(normalizeParams(input.params)), updatedAt).run();
  const row = await db.prepare("SELECT params, updated_at FROM exercise_params WHERE exercise_id = ?").bind(input.exerciseId).first<{ params: string; updated_at: string }>();
  return { exerciseId: input.exerciseId, params: JSON.parse(row!.params) as ParamSet, updatedAt: row!.updated_at };
}

export async function exerciseHistory(db: D1Database, exerciseId: string): Promise<ExerciseHistoryEntry[]> {
  const seed = seedExercise(exerciseId);
  const ids = seed ? [exerciseId, `legacy:${nameKey(seed.name)}`] : [exerciseId];
  const { results } = await db.prepare(`SELECT name, date, section, detail FROM exercise_log
    WHERE exercise_id IN (${ids.map(() => "?").join(",")}) ORDER BY date DESC, ord ASC LIMIT 200`)
    .bind(...ids).all<LogHistoryRow>();
  return results.map(historyEntry);
}

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
  const [statsRes, histRes, paramsRes] = await db.batch([
    db.prepare("SELECT exercise_id, name_key, name, section, COUNT(*) AS c, MAX(date) AS last FROM exercise_log GROUP BY exercise_id, name_key, section"),
    db.prepare(`SELECT exercise_id, name_key, name, date, section, detail FROM (
      SELECT exercise_id, name_key, name, date, section, detail,
        ROW_NUMBER() OVER (PARTITION BY exercise_id, name_key, section ORDER BY date DESC, ord ASC) AS rn
      FROM exercise_log
    ) WHERE rn <= 4 ORDER BY exercise_id, section, date DESC`),
    db.prepare("SELECT exercise_id, params FROM exercise_params"),
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
    (history[id] ??= []).push(historyEntry(r));
  }
  // Old name-based and current IDs can resolve to the same exercise after SQL's per-ID limit.
  for (const [id, entries] of Object.entries(history)) {
    const counts: Partial<Record<ExerciseContext, number>> = {};
    history[id] = entries.sort((a, b) => b.date.localeCompare(a.date)).filter((entry) =>
      (counts[entry.section] = (counts[entry.section] ?? 0) + 1) <= 4);
  }
  const params = { ...SEED_PARAMS, ...Object.fromEntries((paramsRes?.results ?? []).map((row) => {
    const value = row as { exercise_id: string; params: string };
    return [value.exercise_id, JSON.parse(value.params) as ParamSet];
  })) };
  return { catalog: await catalog(db), stats: [...stats.values()], history, params };
}
