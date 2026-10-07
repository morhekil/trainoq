import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS, normalizeParams, paramsKey, paramsName, valuesOf } from "../shared/exercises/params";
import { SEED_PARAMS } from "../shared/exercises/seed";
import { formatSet, formatSets, formatSetup } from "../shared/exercises/format";
import { daySchema } from "../shared/days/schema";

describe("exercise parameters", () => {
  it("orders each copy and gives equivalent sets the same key and name", () => {
    const input = { perSet: ["reps", "height"] as ("reps" | "height")[] };
    const result = normalizeParams(input);
    expect(result).toEqual({ perSet: ["height", "reps"] });
    expect(result).not.toBe(input);
    expect(paramsKey(result)).toBe("height,reps");
    expect(paramsName(result)).toBe("Box height × reps");
    expect(paramsKey(normalizeParams(input))).toBe(paramsKey(result));
    expect(DEFAULT_PARAMS).toEqual({ perSet: ["weight", "reps"] });
  });

  it("keeps only the selected values and leaves missing values empty", () => {
    expect(valuesOf({ height: 24, weight: 10 }, { perSet: ["height", "reps"] })).toEqual({ height: 24, reps: null });
  });

  it("starts holds, hangboard and pike push-up with their own measurements", () => {
    expect(SEED_PARAMS["seed:0029"]).toEqual({ perSet: ["time"] });
    expect(SEED_PARAMS["seed:0079"]).toEqual({ perSet: ["edge", "time", "reps"] });
    expect(SEED_PARAMS["seed:0121"]).toEqual({ perSet: ["height", "reps"] });
  });

  it("formats each measured value and groups matching parameter values", () => {
    expect(formatSet({ edge: 20, time: 15, reps: 3 }, { perSet: ["edge", "time", "reps"] })).toBe("20mm 15s×3");
    expect(formatSet({ weight: 0, time: 30 }, { perSet: ["weight", "time"] })).toBe("BW 30s");
    expect(formatSet({ distance: 1500, time: 120 }, { perSet: ["distance", "time"] })).toBe("1.5km 2:00");
    expect(formatSetup({ angle: 40 }, { setup: ["angle"], perSet: ["weight", "reps"] })).toBe("bench 40°");
    expect(formatSets([
      { type: "warmup", height: 24, reps: 5 },
      { type: "warmup", height: 24, reps: 5 },
      { type: "warmup", height: 24, reps: 6 },
    ], { perSet: ["height", "reps"] })).toBe("warm-up 24in×5 ×2, 24in×6");
  });

  it("records band assistance per set as a whole number from 0 (no band) to 5 (most assistance)", () => {
    expect(normalizeParams({ perSet: ["reps", "band"] })).toEqual({ perSet: ["band", "reps"] });
    expect(paramsName({ perSet: ["band", "time"] })).toBe("Band × time");
    expect(formatSet({ band: 3, reps: 5 }, { perSet: ["band", "reps"] })).toBe("band 3×5");
    expect(formatSet({ band: 0, time: 10 }, { perSet: ["band", "time"] })).toBe("band 0 10s");
    const saves = (band: number) => daySchema.safeParse({
      v: 8, date: "2024-03-06", comments: [], ignoredGarminSourceKeys: [], totalCalories: null,
      events: [{ id: "e", title: null, notes: "", entries: [{ kind: "session", session: {
        id: "s", startedAt: "2024-03-05T23:00:00.000Z", endedAt: null, calories: null, notes: "", warmup: [], cooldown: [],
        main: [{ kind: "exercise", id: "x", exerciseId: "seed:0133", comment: "", params: { perSet: ["band", "reps"] },
          sets: [{ id: "1", type: "working", band, reps: 3 }] }],
      } }] }],
    }).success;
    expect([0, 3, 5].map(saves)).toEqual([true, true, true]);
    expect([-1, 2.5, 6].map(saves)).toEqual([false, false, false]);
  });
});
