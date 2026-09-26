import { SEEDS } from "./seed";
import type { Section } from "./model";

export interface SeedExercise {
  name: string;
  section: Section | "any";
  aliases: string;
}

export const SEED_EXERCISES: SeedExercise[] = SEEDS.map(([name, section, aliases]) => ({
  name,
  section,
  aliases: aliases ?? "",
}));
