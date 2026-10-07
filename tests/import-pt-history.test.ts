import { describe, expect, it } from "vitest";
import { importHistory, type Api, type History } from "../scripts/import_pt_history";
import { addEventEntry, emptyDay, type DayDoc } from "../shared/days/model";
import type { ParamSet } from "../shared/exercises/params";
import type { SessionItem } from "../shared/exercises/model";

const item = (id: string, exerciseId: string): SessionItem =>
  ({ kind: "exercise", id, exerciseId, comment: "", params: { perSet: ["reps"] }, sets: [{ id: `${id}-1`, type: "working", reps: 5 }] });

function sessionDay(date: string, main: SessionItem[], notes = ""): DayDoc {
  const doc = emptyDay(date);
  addEventEntry(doc, { kind: "session", session: { id: `s-${date}`, startedAt: `${date}T00:00:00.000Z`, endedAt: null, warmup: [], main, cooldown: [], calories: null, notes } });
  return doc;
}

function fakeApi(stored: Record<string, DayDoc>, catalog: string[], params: Record<string, ParamSet>) {
  const days = new Map(Object.entries(stored).map(([date, doc]) => [date, { doc, updatedAt: `old-${date}` }]));
  const calls: string[] = [];
  let stamp = 0;
  const api: Api = {
    exercises: {
      library: { query: async () => ({ catalog: catalog.map((id) => ({ id })), params }) },
      create: { mutate: async ({ id }) => { calls.push(`create ${id}`); catalog.push(id); } },
      setParams: { mutate: async ({ exerciseId, params: set }) => { calls.push(`params ${exerciseId}`); params[exerciseId] = set; } },
    },
    days: {
      get: { query: async (date) => structuredClone(days.get(date) ?? { doc: null, updatedAt: null }) },
      save: { mutate: async ({ date, doc, base }) => {
        if ((days.get(date)?.updatedAt ?? null) !== base) return { ok: false };
        calls.push(`save ${date} from ${base}`);
        days.set(date, { doc, updatedAt: `new-${++stamp}` });
        return { ok: true };
      } },
    },
  };
  return { api, calls, days };
}

describe("PT history import", () => {
  const history: History = {
    exercises: [
      { id: "seed:0133", name: "Muscle-up", params: { perSet: ["reps"] }, new: false },
      { id: "seed:0057", name: "Back squat", params: { perSet: ["weight", "reps"] }, new: false },
      { id: "new-sled", name: "Sled push", params: { perSet: ["weight", "reps"] }, new: true },
      { id: "seed:0077", name: "Farmer carry", params: { perSet: ["weight", "reps"] }, new: false, keepDefault: true },
    ],
    days: [
      { date: "2023-01-01", doc: sessionDay("2023-01-01", [item("pt-1", "seed:0057")]) },
      { date: "2023-01-02", doc: sessionDay("2023-01-02", [item("pt-2", "seed:0057")]) },
      { date: "2023-01-03", doc: sessionDay("2023-01-03", [item("pt-3", "seed:0057")]) },
    ],
    merges: [{ date: "2026-09-24", warmup: [], main: [item("pt-4", "seed:0133")], cooldown: [], notes: "PT notes" }],
  };

  it("adds missing definitions and history once, merges into the logged session, and never overwrites other days", async () => {
    const { api, calls, days } = fakeApi({
      "2023-01-02": history.days[1].doc,
      "2023-01-03": sessionDay("2023-01-03", [item("mine", "seed:0057")]),
      "2026-09-24": sessionDay("2026-09-24", [item("mine", "seed:0133")], "Rehab"),
    }, ["seed:0133", "seed:0057", "seed:0077"], { "seed:0077": { perSet: ["weight", "time"] } });

    const first = await importHistory(api, history);
    expect(first).toEqual({ saved: ["2023-01-01", "2026-09-24"], unchanged: ["2023-01-02"], conflicts: ["2023-01-03"] });
    expect(calls).toEqual(["params seed:0133", "create new-sled", "save 2023-01-01 from null", "save 2026-09-24 from old-2026-09-24"]);
    const merged = days.get("2026-09-24")!.doc.events[0].entries[0];
    expect(merged.kind === "session" && merged.session.main.map((entry) => entry.id)).toEqual(["pt-4", "mine"]);
    expect(merged.kind === "session" && merged.session.notes).toBe("Rehab\n\nPT notes");

    calls.length = 0;
    expect(await importHistory(api, history)).toEqual({ saved: [], unchanged: ["2023-01-01", "2023-01-02", "2026-09-24"], conflicts: ["2023-01-03"] });
    expect(calls).toEqual([]);
  });
});
