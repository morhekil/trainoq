import { afterEach, describe, expect, it, vi } from "vitest";
import { SEED_EXERCISES } from "../shared/exercises/catalog";
import { nameKey, type Section } from "../shared/exercises/model";
import { searchExercises, suggestedSet, suggestedSetup, lastTime } from "../frontend/features/exercises/library";
import { clearPendingParams, hasPendingParams, paramsFor, setExerciseParams } from "../frontend/features/exercises/params";
import { exerciseHistory, exerciseLibrary } from "../backend/features/exercises/db";
import { addEventEntry, emptyDay } from "../shared/days/model";
import { exerciseIdForName } from "../shared/exercises/catalog";
import { allCatalog, clearLocalCatalog, setRemoteCatalog } from "../frontend/features/exercises/catalog";

const names = (query: string, section: Section) => searchExercises(query, section).flatMap((g) => g.items.map((i) => i.name));

describe("starter exercise list", () => {
  it("clears cached custom definitions from a signed-out session", () => {
    setRemoteCatalog([{ id: "old", name: "Private move", section: null, aliases: "" }]);
    expect(allCatalog().some((entry) => entry.id === "old")).toBe(true);
    clearLocalCatalog();
    expect(allCatalog().some((entry) => entry.id === "old")).toBe(false);
  });
  it("has no duplicate names, which would collapse into one search entry", () => {
    const seen = new Set<string>();
    const dupes = SEED_EXERCISES.map((s) => nameKey(s.name)).filter((k) => seen.has(k) || !seen.add(k));
    expect(dupes).toEqual([]);
    expect(new Set(SEED_EXERCISES.map((seed) => seed.id)).size).toBe(SEED_EXERCISES.length);
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
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("prefills bench angle from the newest matching entry across sections", () => {
    const map = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      get length() { return map.size; }, key: (i: number) => [...map.keys()][i] ?? null,
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => { map.set(key, value); },
      removeItem: (key: string) => { map.delete(key); },
    });
    const params = { setup: ["angle"], perSet: ["weight", "reps"] } as const;
    const doc = emptyDay("2026-09-22");
    addEventEntry(doc, { kind: "session", session: { id: "s", startedAt: "2026-09-22T07:00:00Z", endedAt: null, calories: null, notes: "",
      warmup: [], main: [{ kind: "exercise", id: "e", exerciseId: "seed:0001", comment: "", params: { setup: [...params.setup], perSet: [...params.perSet] }, setup: { angle: 40 }, sets: [{ id: "s", type: "working", weight: 20, reps: 8 }] }], cooldown: [],
    } });
    map.set(`tq:day:${doc.date}`, JSON.stringify({ doc, dirty: true, base: null, rev: 1 }));
    expect(suggestedSetup("seed:0001", "2026-09-23", { setup: [...params.setup], perSet: [...params.perSet] })).toEqual({ angle: 40 });
    expect(suggestedSetup("seed:0001", "2026-09-23", { perSet: ["weight", "reps"] })).toBeUndefined();
  });

  it("includes a seed's legacy log rows and their weight × reps parameters", async () => {
    let ids: unknown[] = [];
    const db = { prepare: () => ({ bind(...args: unknown[]) { ids = args; return this; }, async all() { return { results: [
      { name: "Pike push-up", date: "2026-10-05", section: "main", detail: JSON.stringify({ params: { perSet: ["height", "reps"] }, sets: [{ type: "working", height: 24, reps: 5 }] }) },
      { name: "Pike push-up", date: "2026-09-28", section: "warmup", detail: JSON.stringify({ sets: [{ type: "working", weight: null, reps: 6 }] }) },
    ] }; } }) } as unknown as D1Database;
    const history = await exerciseHistory(db, "seed:0121");
    expect(ids).toEqual(["seed:0121", "legacy:pike push-up"]);
    expect(history).toMatchObject([
      { date: "2026-10-05", params: { perSet: ["height", "reps"] }, sets: [{ height: 24, reps: 5 }] },
      { date: "2026-09-28", params: { perSet: ["weight", "reps"] }, sets: [{ weight: null, reps: 6 }] },
    ]);
  });

  it("keeps suggestions within the section in offline days", () => {
    const map = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      get length() { return map.size; }, key: (i: number) => [...map.keys()][i] ?? null,
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => { map.set(k, v); },
      removeItem: (k: string) => { map.delete(k); },
    });
    const doc = emptyDay("2026-08-19");
    addEventEntry(doc, { kind: "session", session: { id: "s", startedAt: "2026-08-19T07:00:00Z", endedAt: null, calories: null, notes: "",
      warmup: [{ kind: "exercise", id: "we", exerciseId: exerciseIdForName("Squat"), comment: "", params: { perSet: ["weight", "reps"] }, sets: [{ id: "ws", type: "working", weight: 20, reps: 10 }] }],
      main: [{ kind: "exercise", id: "me", exerciseId: exerciseIdForName("Squat"), comment: "", params: { perSet: ["weight", "reps"] }, sets: [{ id: "ms", type: "working", weight: 100, reps: 5 }] }],
      cooldown: [],
    } });
    map.set(`tq:day:${doc.date}`, JSON.stringify({ doc, dirty: true, base: null, rev: 1 }));
    expect(suggestedSet(exerciseIdForName("Squat"), "2026-08-20", "warmup")?.weight).toBe(20);
    expect(suggestedSet(exerciseIdForName("Squat"), "2026-08-20", "main")?.weight).toBe(100);
    expect(suggestedSet(exerciseIdForName("Squat"), "2026-08-20", "cooldown")).toBeNull();
  });

  it("keeps parameter changes on the phone and suggests only matching records", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-05T08:20:11.000Z"));
    const map = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      get length() { return map.size; }, key: (i: number) => [...map.keys()][i] ?? null,
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => { map.set(key, value); },
      removeItem: (key: string) => { map.delete(key); },
    });
    const doc = emptyDay("2026-10-05");
    addEventEntry(doc, { kind: "session", session: { id: "s", startedAt: "2026-10-05T07:00:00Z", endedAt: null, calories: null, notes: "",
      warmup: [{ kind: "exercise", id: "e", exerciseId: "seed:0121", comment: "", params: { perSet: ["weight", "reps"] }, sets: [{ id: "s", type: "working", weight: null, reps: 6 }] }], main: [], cooldown: [],
    } });
    map.set(`tq:day:${doc.date}`, JSON.stringify({ doc, dirty: true, base: null, rev: 1 }));
    expect(lastTime("seed:0121", "2026-10-06", "warmup")?.params).toEqual({ perSet: ["weight", "reps"] });
    expect(suggestedSet("seed:0121", "2026-10-06", "warmup", { perSet: ["height", "reps"] })).toBeNull();
    setExerciseParams("seed:0121", { perSet: ["height", "reps"] });
    expect(paramsFor("seed:0121")).toEqual({ perSet: ["height", "reps"] });
    expect(hasPendingParams()).toBe(true);
    const first = JSON.parse(map.get("tq:params")!)["seed:0121"];
    expect(first.params).toEqual({ perSet: ["height", "reps"] });
    setExerciseParams("seed:0121", { perSet: ["time"] });
    expect(JSON.parse(map.get("tq:params")!)["seed:0121"].updatedAt > first.updatedAt).toBe(true);
    clearPendingParams();
  });

  it("returns section-tagged set history from current and legacy log rows", async () => {
    const db = { prepare: () => ({ all: async () => ({ results: [] }) }), async batch() { return [
      { results: [{ exercise_id: exerciseIdForName("Squat"), name_key: "squat", name: "Squat", section: "warmup", c: 1, last: "2026-09-01" }] },
      { results: [
        { exercise_id: exerciseIdForName("Squat"), name: "Squat", date: "2026-09-01", section: "warmup", detail: JSON.stringify({ sets: [{ type: "working", weight: 20, reps: 10 }] }) },
        { exercise_id: exerciseIdForName("Squat"), name: "Squat", date: "2026-08-01", section: "cooldown", detail: JSON.stringify({ reps: "2x8" }) },
      ] },
    ]; } } as unknown as D1Database;
    const lib = await exerciseLibrary(db);
    expect(lib.history[exerciseIdForName("Squat")]).toEqual([
      { date: "2026-09-01", section: "warmup", params: { perSet: ["weight", "reps"] }, sets: [{ type: "working", weight: 20, reps: 10 }] },
      { date: "2026-08-01", section: "cooldown", params: { perSet: ["weight", "reps"] }, sets: [{ type: "working", weight: null, reps: 8 }, { type: "working", weight: null, reps: 8 }] },
    ]);
  });

  it("includes activity results in the same exercise history and usage counts", async () => {
    const id = exerciseIdForName("Walk");
    const db = { prepare: () => ({ all: async () => ({ results: [] }) }), async batch() { return [
      { results: [
        { exercise_id: "legacy:walk", name: "Walk", section: "activity", c: 4, last: "2026-09-27" },
        { exercise_id: id, name: "Walk", section: "activity", c: 1, last: "2026-09-28" },
      ] },
      { results: [
        ...[27, 26, 25, 24].map((day) => ({ exercise_id: "legacy:walk", name: "Walk", date: `2026-09-${day}`, section: "activity", detail: JSON.stringify({ minutes: day, calories: null }) })),
        { exercise_id: id, name: "Walk", date: "2026-09-28", section: "activity", detail: JSON.stringify({ minutes: 45, calories: 190 }) },
      ] },
    ]; } } as unknown as D1Database;
    const lib = await exerciseLibrary(db);
    expect(lib.stats[0]).toMatchObject({ exerciseId: id, count: 5, sections: { activity: 5 } });
    expect(lib.history[id]).toEqual([
      { date: "2026-09-28", section: "activity", result: { minutes: 45, calories: 190 } },
      ...[27, 26, 25].map((day) => ({ date: `2026-09-${day}`, section: "activity", result: { minutes: day, calories: null } })),
    ]);
  });
});
