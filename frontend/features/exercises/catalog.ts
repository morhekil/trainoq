import { SEED_EXERCISES, seedExercise } from "../../../shared/exercises/catalog";
import { nameKey, type ExerciseLibrary } from "../../../shared/exercises/model";
import { dayActivities, daySessions, type DayDoc } from "../../../shared/days/model";
import { request, trpc } from "../../api";
import { lsGet, lsSet } from "../../storage";

type CatalogEntry = ExerciseLibrary["catalog"][number];
const KEY = "tq:catalog";
let local = lsGet<CatalogEntry[]>(KEY) ?? [];
let remote: CatalogEntry[] = [];

export function setRemoteCatalog(entries: CatalogEntry[] = []): void { remote = entries ?? []; }
export function allCatalog(): CatalogEntry[] {
  const map = new Map([...SEED_EXERCISES, ...remote, ...local].map((entry) => [entry.id, entry]));
  return [...map.values()];
}
export function exerciseName(id: string): string {
  return allCatalog().find((entry) => entry.id === id)?.name ?? id;
}
export function findExerciseByName(name: string): CatalogEntry | undefined {
  return allCatalog().find((entry) => nameKey(entry.name) === nameKey(name));
}
export function registerExercise(id: string, name: string): void {
  if (seedExercise(id)) return;
  if (!local.some((entry) => entry.id === id)) {
    local = [...local, { id, name: name.trim().replace(/\s+/g, " "), section: null, aliases: "" }];
    lsSet(KEY, local);
  }
}
export function clearLocalCatalog(): void { local = []; remote = []; }
export function createLocalExercise(name: string): CatalogEntry {
  const found = findExerciseByName(name);
  if (found) return found;
  const id = crypto.randomUUID();
  registerExercise(id, name);
  return local.find((entry) => entry.id === id)!;
}
export async function syncDefinitions(doc: DayDoc): Promise<void> {
  const ids = new Set<string>();
  for (const session of daySessions(doc))
    for (const section of ["warmup", "main", "cooldown"] as const)
      for (const item of session[section])
        for (const exercise of item.kind === "exercise" ? [item] : item.members) ids.add(exercise.exerciseId);
  for (const activity of dayActivities(doc)) ids.add(activity.exerciseId);
  for (const id of ids) {
    if (seedExercise(id)) continue;
    const entry = allCatalog().find((candidate) => candidate.id === id);
    if (!entry) throw new Error(`Exercise definition missing: ${id}`);
    await request(trpc.exercises.create.mutate({ id, name: entry.name }));
  }
}
