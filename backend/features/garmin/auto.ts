import { emptyDay } from "../../../shared/days/model";
import { exerciseIdForName, seedExercise } from "../../../shared/exercises/catalog";
import { nameKey } from "../../../shared/exercises/model";
import { autoImport } from "../../../shared/garmin/decisions";
import type { GarminActivitySummary } from "../../../shared/garmin/fit";
import { getDay, putDay } from "../days/db";
import { createExercise } from "../exercises/db";
import { autoImportCandidates, markAutoImported } from "./db";

/** The exercise review would pick for a recording title: a built-in or catalog name, else a new custom exercise. */
async function exerciseFor(db: D1Database, title: string): Promise<string> {
  const seed = exerciseIdForName(title);
  if (seedExercise(seed)) return seed;
  const found = await db.prepare("SELECT id FROM exercise_catalog WHERE name_key = ? LIMIT 1").bind(nameKey(title)).first<{ id: string }>();
  return found?.id ?? (await createExercise(db, { id: crypto.randomUUID(), name: title })).id;
}

/**
 * Decides recent pending recordings into their days with `autoImport`, through `putDay`'s revision check.
 * Each decided recording is marked, so one you later unlink or delete stays pending. Strength without exactly one
 * matching session waits for review; a day a browser save just changed is retried on the next run.
 */
export async function autoImportGarmin(db: D1Database): Promise<void> {
  const byDate = new Map<string, GarminActivitySummary[]>();
  for (const source of await autoImportCandidates(db)) byDate.set(source.localDate!, [...(byDate.get(source.localDate!) ?? []), source]);
  for (const [date, sources] of byDate) {
    const stored = await getDay(db, date);
    const doc = stored?.doc ?? emptyDay(date);
    const exercises = new Map<string, string>();
    for (const { title, subSport } of sources)
      if (subSport !== "strengthTraining" && !exercises.has(title)) exercises.set(title, await exerciseFor(db, title));
    const decided = autoImport(doc, sources, (title) => exercises.get(title)!);
    if (decided.length && (await putDay(db, date, doc, stored?.updatedAt ?? null)).ok) await markAutoImported(db, decided);
  }
}
