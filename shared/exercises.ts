import type { Section } from "./types";

/**
 * Starter exercise list for search. Anything typed that isn't here is saved as-is
 * and shows up in search from then on.
 * [name, section hint, aliases]
 */
type Seed = [string, Section | "any", string?];

const SEEDS: Seed[] = [
  // mobility / warm-up / physio
  ["Cat cow", "warmup", "cat camel spine"],
  ["Standing knee to chest", "warmup"],
  ["Kneeling knee to chest", "warmup"],
  ["Plank knee to elbow", "warmup", "mountain climber"],
  ["Dead bug", "warmup", "core"],
  ["Bird dog", "warmup", "core"],
  ["Side plank", "warmup", "core"],
  ["Plank", "warmup", "core front"],
  ["Glute bridge", "warmup", "hip"],
  ["Single-leg glute bridge", "warmup", "hip"],
  ["Clamshell", "warmup", "hip band"],
  ["McGill curl-up", "warmup", "core big 3"],
  ["Pallof press", "warmup", "core anti-rotation cable band"],
  ["Copenhagen plank", "warmup", "adductor core"],
  ["Hip flexor stretch", "warmup", "kneeling lunge stretch"],
  ["90/90 hip switch", "warmup", "hip mobility"],
  ["World's greatest stretch", "warmup"],
  ["Thoracic rotation", "warmup", "t-spine open book"],
  ["Child's pose", "cooldown", "stretch"],
  ["Foam rolling – back", "warmup", "foam roller thoracic"],
  ["Foam rolling – legs", "warmup", "foam roller quads it band"],
  ["Band pull-apart", "warmup", "banded shoulder"],
  ["Band dislocates", "warmup", "banded shoulder pass-through"],
  ["Banded standing flies", "warmup", "banded shoulder reverse fly"],
  ["Band external rotation", "warmup", "banded shoulder rotator cuff"],
  ["Face pull", "any", "cable band rear delt"],
  ["Scapular shrugs", "any", "scap pull-up hang shrug"],
  ["Scapular push-up", "warmup", "scap"],
  ["Dead hang", "any", "bar hang"],
  ["Jefferson curl", "cooldown", "kettlebell spine flexion"],
  ["Hamstring stretch", "cooldown"],
  ["Pigeon stretch", "cooldown", "hip glute"],
  ["Walk", "cooldown", "walking"],
  ["Bike", "any", "cycling stationary"],
  ["Rower", "any", "rowing erg"],
  ["Skipping", "warmup", "jump rope"],
  // upper push
  ["Bench press", "main", "barbell flat"],
  ["Incline bench press", "main", "barbell 40 degree incline"],
  ["Dumbbell bench press", "main", "db flat"],
  ["Incline dumbbell press", "main", "db"],
  ["Overhead press", "main", "ohp military barbell shoulder"],
  ["Dumbbell shoulder press", "main", "db overhead"],
  ["Push-up", "any", "press-up"],
  ["Dips", "main", "parallel bar"],
  ["Lateral raise", "main", "db shoulder"],
  ["Triceps pushdown", "main", "cable"],
  ["Skull crusher", "main", "triceps extension"],
  // upper pull
  ["Pull-up", "main", "chin weighted"],
  ["Chin-up", "main", "pull-up supinated"],
  ["Lat pulldown", "main", "cable"],
  ["Barbell row", "main", "bent over"],
  ["Dumbbell row", "main", "db single arm"],
  ["Seated cable row", "main", "row"],
  ["Inverted row", "main", "ring row bodyweight"],
  ["Biceps curl", "main", "db barbell"],
  ["Hammer curl", "main", "db"],
  // lower
  ["Back squat", "main", "barbell"],
  ["Front squat", "main", "barbell"],
  ["Goblet squat", "main", "kettlebell dumbbell"],
  ["Deadlift", "main", "barbell conventional"],
  ["Romanian deadlift", "main", "rdl barbell dumbbell"],
  ["Trap bar deadlift", "main", "hex bar"],
  ["Hip thrust", "main", "barbell glute"],
  ["Dumbbell lunges", "main", "walking lunge"],
  ["Reverse lunge", "main"],
  ["Bulgarian split squat", "main", "rear foot elevated rfess"],
  ["Step-up", "main", "box"],
  ["Leg press", "main", "machine"],
  ["Leg curl", "main", "hamstring machine"],
  ["Leg extension", "main", "quad machine"],
  ["Nordic curl", "main", "hamstring"],
  ["Calf raise", "main"],
  ["Kettlebell swing", "main", "kb"],
  // core / carries
  ["Hanging knee raise", "main", "abs"],
  ["Hanging leg raise", "main", "abs"],
  ["Ab wheel rollout", "main", "abs"],
  ["Farmer carry", "main", "loaded carry walk"],
  ["Suitcase carry", "main", "loaded carry"],
  // climbing
  ["Hangboard", "main", "fingerboard max hang"],
  ["Bouldering", "any", "climbing"],
  ["Campus board", "main", "climbing"],
];

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
