import { z } from "zod";
import type { DayDoc } from "./model";
import { DATE_RE } from "./model";

export const dateSchema = z.string().regex(DATE_RE);

const workSet = z.object({
  id: z.string(),
  type: z.enum(["warmup", "working", "backoff"]),
  weight: z.number().finite().nullable(),
  reps: z.number().finite().nullable(),
});

const simpleItem = z.object({ id: z.string(), name: z.string(), reps: z.string(), comment: z.string() });

export const daySchema = z.object({
  v: z.literal(1),
  date: dateSchema,
  morning: z.string(),
  sessions: z.array(z.object({
    id: z.string(),
    startedAt: z.string(),
    endedAt: z.string().nullable(),
    warmup: z.array(simpleItem),
    main: z.array(z.object({
      id: z.string(),
      exercises: z.array(z.object({ id: z.string(), name: z.string(), sets: z.array(workSet), comment: z.string() })),
    })),
    cooldown: z.array(simpleItem),
    calories: z.number().finite().nullable(),
    notes: z.string(),
  })),
  activities: z.array(z.object({
    id: z.string(), name: z.string(), minutes: z.number().finite().nullable(), calories: z.number().finite().nullable(), notes: z.string(),
  })),
  totalCalories: z.number().finite().nullable(),
  notes: z.string(),
}) satisfies z.ZodType<DayDoc>;
