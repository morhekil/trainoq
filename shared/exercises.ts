import { SEEDS } from "./seed-exercises";
import type { Section } from "./types";

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

export const ACTIVITY_SUGGESTIONS = ["Walk", "Run", "Ride", "Bouldering", "Swim", "Hike", "Yoga", "Mobility"];
