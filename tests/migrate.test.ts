import { describe, expect, it } from "vitest";
import { emptyDay } from "../shared/days/model";
import { migrateDay, normalizeDay, type LegacyDayDoc } from "../shared/days/migrate";
import { daySchema } from "../shared/days/schema";
import type { StandaloneExercise } from "../shared/exercises/model";

const doc: LegacyDayDoc = {
  ...emptyDay("2026-09-25"),
  v: 1,
  activities: [],
  sessions: [{
    id: "session",
    startedAt: "2026-09-25T07:00:00.000Z",
    endedAt: null,
    warmup: [
      { id: "a", name: "Rows", reps: "2x10", comment: "" },
      { id: "b", name: "Hold", reps: "30s", comment: "steady" },
      { id: "c", name: "Halo", reps: "12kg 10r each way", comment: "" },
      { id: "d", name: "Squat", reps: "12kg 10r", comment: "" },
      { id: "e", name: "Deadlift", reps: "5", comment: "20kg empty barbell" },
      { id: "f", name: "Cat cow", reps: "", comment: "" },
    ],
    main: [{ id: "main-block", exercises: [{ id: "main-exercise", name: "Press", comment: "", sets: [{ id: "main-set", type: "working", weight: 40, reps: 6 }] }] }],
    cooldown: [{ id: "g", name: "Curl", reps: "4", comment: "4kg kettlebell" }],
    calories: null,
    notes: "",
  }],
};

describe("v1 day migration", () => {
  it("converts the observed simple values to numeric sets without changing main", () => {
    const migrated = migrateDay(doc);
    const s = migrated.sessions[0];
    const [rows, hold, halo, squat, deadlift, catCow] = s.warmup as StandaloneExercise[];
    const curl = s.cooldown[0] as StandaloneExercise;
    const values = (sets: typeof rows.sets) => sets.map(({ type, weight, reps }) => ({ type, weight, reps }));

    expect(migrated.v).toBe(4);
    expect(s.warmup.map((item) => item.id)).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(values(rows.sets)).toEqual([{ type: "working", weight: null, reps: 10 }, { type: "working", weight: null, reps: 10 }]);
    expect(values(hold.sets)).toEqual([{ type: "working", weight: null, reps: null }]);
    expect(hold.comment).toBe("steady; 30s");
    expect(values(halo.sets)).toEqual([{ type: "working", weight: 12, reps: 10 }]);
    expect(halo.comment).toBe("each way");
    expect(values(squat.sets)).toEqual([{ type: "working", weight: 12, reps: 10 }]);
    expect(values(deadlift.sets)).toEqual([{ type: "working", weight: 20, reps: 5 }]);
    expect(deadlift.comment).toBe("20kg empty barbell");
    expect(values(catCow.sets)).toEqual([{ type: "working", weight: null, reps: null }]);
    expect(values(curl.sets)).toEqual([{ type: "working", weight: 4, reps: 4 }]);
    expect(curl.comment).toBe("4kg kettlebell");
    expect(s.main[0]).toMatchObject({ kind: "exercise", id: "main-exercise", comment: "", sets: [{ id: "main-set", type: "working", weight: 40, reps: 6 }] });
    expect(migrateDay(doc)).toEqual(migrated);
    expect(doc.sessions[0].warmup[0].reps).toBe("2x10");
    expect(new Set([...s.warmup, ...s.main, ...s.cooldown].map((item) => item.id)).size).toBe(8);
  });

  it("rejects an unknown legacy value instead of losing it", () => {
    const unknown = structuredClone(doc);
    unknown.sessions[0].warmup[0].reps = "tenish";
    expect(() => migrateDay(unknown)).toThrow(/tenish/);
  });

  it("normalizes v1 once and validates the canonical v4 day", () => {
    const migrated = normalizeDay(doc);
    expect(migrated).toEqual(migrateDay(doc));
    expect(normalizeDay(migrated)).toBe(migrated);
    expect(daySchema.parse(migrated)).toEqual(migrated);
    expect(() => daySchema.parse(doc)).toThrow();
  });
});
