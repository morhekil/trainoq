import type { Block, SimpleItem, WorkSet } from "../exercises/model";
import type { Session } from "../sessions/model";
import type { DayDoc } from "./model";

export type MigratedDayDoc = Omit<DayDoc, "v" | "sessions"> & {
  v: 2;
  sessions: (Omit<Session, "warmup" | "cooldown"> & { warmup: Block[]; cooldown: Block[] })[];
};

function migrateItem(item: SimpleItem): Block {
  const value = item.reps.trim();
  let count = 1;
  let reps: number | null = null;
  let weight: number | null = null;
  let comment = item.comment;
  let match: RegExpMatchArray | null;

  if (/^\d+$/.test(value)) {
    reps = Number(value);
  } else if ((match = value.match(/^2x(\d+)$/i))) {
    count = 2;
    reps = Number(match[1]);
  } else if (/^\d+s$/.test(value)) {
    comment = [comment.trim(), value].filter(Boolean).join("; ");
  } else if ((match = value.match(/^(\d+(?:\.\d+)?)kg (\d+)r(?: (each way))?$/i))) {
    weight = Number(match[1]);
    reps = Number(match[2]);
    if (match[3]) comment = [comment.trim(), match[3]].filter(Boolean).join("; ");
  } else if (value) {
    throw new Error(`Unrecognized reps for ${item.name}: ${value}`);
  }

  if (weight == null && (match = comment.match(/\b(\d+(?:\.\d+)?)\s*kg\b/i))) weight = Number(match[1]);

  const sets: WorkSet[] = Array.from({ length: count }, (_, i) => ({
    id: `migrated:set:${item.id}:${i}`,
    type: "working",
    weight,
    reps,
  }));
  return { id: `migrated:block:${item.id}`, exercises: [{ id: item.id, name: item.name, sets, comment }] };
}

/** Convert the audited v1 day shape to numeric-set blocks in every section. */
export function migrateDay(doc: DayDoc): MigratedDayDoc {
  const copy = structuredClone(doc);
  return {
    ...copy,
    v: 2,
    sessions: copy.sessions.map((s) => ({
      ...s,
      warmup: s.warmup.map(migrateItem),
      cooldown: s.cooldown.map(migrateItem),
    })),
  };
}
