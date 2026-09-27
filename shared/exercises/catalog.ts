import { SEEDS } from "./seed";
import { nameKey, type Section } from "./model";

export interface SeedExercise {
  id: string;
  name: string;
  section: Section | "any";
  aliases: string;
}

export const SEED_EXERCISES: SeedExercise[] = SEEDS.map(([id, name, section, aliases]) => ({
  id,
  name,
  section,
  aliases: aliases ?? "",
}));

const seedByName = new Map(SEED_EXERCISES.map((s) => [nameKey(s.name), s]));
export function exerciseIdForName(name: string): string {
  const key = nameKey(name);
  return seedByName.get(key)?.id ?? `legacy:${key}`;
}

export function seedExercise(id: string): SeedExercise | undefined {
  return SEED_EXERCISES.find((s) => s.id === id);
}
