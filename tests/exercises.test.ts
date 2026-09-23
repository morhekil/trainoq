import { describe, expect, it } from "vitest";
import { SEED_EXERCISES } from "../shared/exercises";
import { nameKey, type Section } from "../shared/types";
import { searchExercises } from "../src/lib/library";

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
});
