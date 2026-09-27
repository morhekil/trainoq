import { afterEach, describe, expect, it, vi } from "vitest";
import { SEED_EXERCISES } from "../shared/exercises/catalog";
import { nameKey, type Section } from "../shared/exercises/model";
import { searchExercises, suggestedSet } from "../frontend/features/exercises/library";
import { exerciseLibrary } from "../backend/features/exercises/db";
import { emptyDay } from "../shared/days/model";

const names = (query: string, section: Section) => searchExercises(query, section).flatMap((g) => g.items.map((i) => i.name));

describe("starter exercise list", () => {
  it("has no duplicate names, which would collapse into one search entry", () => {
    const seen = new Set<string>();
    const dupes = SEED_EXERCISES.map((s) => nameKey(s.name)).filter((k) => seen.has(k) || !seen.add(k));
    expect(dupes).toEqual([]);
  });

  it("finds band and calisthenics work by the short names people type", () => {
    expect(names("hspu", "main")).toContain("Handstand push-up");
    expect(names("ppp", "main")).toContain("Pseudo planche push-up");
    expect(names("tke", "warmup")).toContain("Terminal knee extension");
    expect(names("band row", "main")).toContain("Band row");
  });

  it("puts the plain exercise first however the hyphen is typed", () => {
    for (const q of ["push-up", "push up", "pushup"]) expect(names(q, "main")[0]).toBe("Push-up");
    for (const q of ["pull up", "pullup"]) expect(names(q, "main")[0]).toBe("Pull-up");
    expect(names("muscleup", "main")[0]).toBe("Muscle-up");
  });
});

describe("exercise history", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps suggestions within the section in offline days", () => {
    const map = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      get length() { return map.size; }, key: (i: number) => [...map.keys()][i] ?? null,
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => { map.set(k, v); },
      removeItem: (k: string) => { map.delete(k); },
    });
    const doc = emptyDay("2026-08-19");
    doc.sessions = [{ id: "s", startedAt: "2026-08-19T07:00:00Z", endedAt: null, calories: null, notes: "",
      warmup: [{ id: "w", exercises: [{ id: "we", name: "Squat", comment: "", sets: [{ id: "ws", type: "working", weight: 20, reps: 10 }] }] }],
      main: [{ id: "m", exercises: [{ id: "me", name: "Squat", comment: "", sets: [{ id: "ms", type: "working", weight: 100, reps: 5 }] }] }],
      cooldown: [],
    }];
    map.set(`tq:day:${doc.date}`, JSON.stringify({ doc, dirty: true, base: null, rev: 1 }));
    expect(suggestedSet("Squat", "2026-08-20", "warmup")?.weight).toBe(20);
    expect(suggestedSet("Squat", "2026-08-20", "main")?.weight).toBe(100);
    expect(suggestedSet("Squat", "2026-08-20", "cooldown")).toBeNull();
  });

  it("returns section-tagged set history from current and legacy log rows", async () => {
    const db = { prepare: () => ({}), async batch() { return [
      { results: [{ name_key: "squat", name: "Squat", section: "warmup", c: 1, last: "2026-09-01" }] },
      { results: [
        { name_key: "squat", date: "2026-09-01", section: "warmup", detail: JSON.stringify({ sets: [{ type: "working", weight: 20, reps: 10 }] }) },
        { name_key: "squat", date: "2026-08-01", section: "cooldown", detail: JSON.stringify({ reps: "2x8" }) },
      ] },
    ]; } } as unknown as D1Database;
    const lib = await exerciseLibrary(db);
    expect(lib.history.squat).toEqual([
      { date: "2026-09-01", section: "warmup", sets: [{ type: "working", weight: 20, reps: 10 }] },
      { date: "2026-08-01", section: "cooldown", sets: [{ type: "working", weight: null, reps: 8 }, { type: "working", weight: null, reps: 8 }] },
    ]);
  });
});
