import { z } from "zod";
import type { DayDoc } from "./model";
import type { LegacyDayDoc } from "./migrate";
import { normalizeDay } from "./migrate";
import { DATE_RE } from "./model";

export const dateSchema = z.string().regex(DATE_RE);

const workSet = z.object({
  id: z.string(),
  type: z.enum(["warmup", "working", "backoff"]),
  weight: z.number().finite().nullable(),
  reps: z.number().finite().nullable(),
});

const legacyItem = z.object({ id: z.string(), name: z.string(), reps: z.string(), comment: z.string() });
const block = z.object({
  id: z.string(),
  exercises: z.array(z.object({ id: z.string(), name: z.string(), sets: z.array(workSet), comment: z.string() })),
});

const session = z.object({
  id: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  warmup: z.array(block),
  main: z.array(block),
  cooldown: z.array(block),
  calories: z.number().finite().nullable(),
  notes: z.string(),
});

export const daySchema = z.object({
  v: z.literal(2),
  date: dateSchema,
  morning: z.string(),
  sessions: z.array(session),
  activities: z.array(z.object({
    id: z.string(), name: z.string(), minutes: z.number().finite().nullable(), calories: z.number().finite().nullable(), notes: z.string(),
  })),
  totalCalories: z.number().finite().nullable(),
  notes: z.string(),
}) satisfies z.ZodType<DayDoc>;

export const legacyDaySchema = daySchema.extend({
  v: z.literal(1),
  sessions: z.array(session.extend({ warmup: z.array(legacyItem), cooldown: z.array(legacyItem) })),
}) satisfies z.ZodType<LegacyDayDoc>;

export const inputDaySchema = z.union([daySchema, legacyDaySchema]).transform(normalizeDay);
