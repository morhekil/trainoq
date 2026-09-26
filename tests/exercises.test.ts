import { describe, expect, it } from "vitest";
import { SEED_EXERCISES } from "../shared/exercises/catalog";
import { nameKey, type Section } from "../shared/exercises/model";
import { searchExercises } from "../frontend/features/exercises/library";

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
