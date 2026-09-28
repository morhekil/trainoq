import { z } from "zod";
import type { DayDoc } from "./model";
import { normalizeDay, type LegacyDayDoc, type V2DayDoc, type V3DayDoc, type V4DayDoc } from "./migrate";
import { DATE_RE } from "./model";

export const dateSchema = z.string().regex(DATE_RE);
const setValues = { weight: z.number().finite().nullable(), reps: z.number().finite().nullable() };
const workSet = z.object({ id: z.string().min(1), type: z.enum(["warmup", "working", "backoff"]), ...setValues });
const performed = { id: z.string().min(1), exerciseId: z.string().min(1), comment: z.string() };
const exercise = z.object({ kind: z.literal("exercise"), ...performed, sets: z.array(workSet) });
const superset = z.object({
  kind: z.literal("superset"), id: z.string().min(1),
  members: z.array(z.object(performed)),
  rounds: z.array(z.object({ id: z.string().min(1), type: workSet.shape.type })),
  results: z.array(z.object({ memberId: z.string(), roundId: z.string(), ...setValues })),
}).superRefine((item, ctx) => {
  const members = new Set(item.members.map((m) => m.id));
  const rounds = new Set(item.rounds.map((r) => r.id));
  if (members.size !== item.members.length || rounds.size !== item.rounds.length)
    ctx.addIssue({ code: "custom", message: "Duplicate member or round ID" });
  const pairs = new Set<string>();
  for (const result of item.results) {
    const key = JSON.stringify([result.memberId, result.roundId]);
    if (!members.has(result.memberId) || !rounds.has(result.roundId) || pairs.has(key)) ctx.addIssue({ code: "custom", message: "Invalid result pair" });
    pairs.add(key);
  }
  if (pairs.size !== members.size * rounds.size) ctx.addIssue({ code: "custom", message: "Missing result pair" });
});
const sessionFields = {
  id: z.string(), startedAt: z.string(), endedAt: z.string().nullable(),
  calories: z.number().finite().nullable(), notes: z.string(),
};
const session = z.object({ ...sessionFields, warmup: z.array(z.union([exercise, superset])), main: z.array(z.union([exercise, superset])), cooldown: z.array(z.union([exercise, superset])) });
const linkedSession = session.extend({ garminSourceKey: z.string().min(1).optional() });
const dayFields = {
  date: dateSchema, morning: z.string(),
  totalCalories: z.number().finite().nullable(), notes: z.string(),
};
const activityResult = { minutes: z.number().finite().nullable(), calories: z.number().finite().nullable() };
const activities = z.array(z.object({ ...performed, result: z.object(activityResult) }));
const linkedActivities = z.array(z.object({ ...performed, result: z.object(activityResult), startedAt: z.iso.datetime().optional(), garminSourceKey: z.string().min(1).optional() }));
const legacyActivities = z.array(z.object({ id: z.string(), name: z.string(), ...activityResult, notes: z.string() }));
export const daySchema = z.object({ v: z.literal(5), ...dayFields, sessions: z.array(linkedSession), activities: linkedActivities, ignoredGarminSourceKeys: z.array(z.string().min(1)) }) satisfies z.ZodType<DayDoc>;
export const v4DaySchema = z.object({ v: z.literal(4), ...dayFields, sessions: z.array(session), activities }) satisfies z.ZodType<V4DayDoc>;
export const v3DaySchema = z.object({ v: z.literal(3), ...dayFields, sessions: z.array(session), activities: legacyActivities }) satisfies z.ZodType<V3DayDoc>;

const legacyExercise = z.object({ id: z.string(), name: z.string(), sets: z.array(workSet), comment: z.string() });
const block = z.object({ id: z.string(), exercises: z.array(legacyExercise) });
const legacyItem = z.object({ id: z.string(), name: z.string(), reps: z.string(), comment: z.string() });
const v2Session = z.object({ ...sessionFields, warmup: z.array(block), main: z.array(block), cooldown: z.array(block) });
export const v2DaySchema = z.object({ v: z.literal(2), ...dayFields, sessions: z.array(v2Session), activities: legacyActivities }) satisfies z.ZodType<V2DayDoc>;
export const legacyDaySchema = z.object({ v: z.literal(1), ...dayFields, sessions: z.array(v2Session.extend({ warmup: z.array(legacyItem), cooldown: z.array(legacyItem) })), activities: legacyActivities }) satisfies z.ZodType<LegacyDayDoc>;
export const rawDaySchema = z.union([daySchema, v4DaySchema, v3DaySchema, v2DaySchema, legacyDaySchema]);
export const inputDaySchema = rawDaySchema.transform(normalizeDay);
