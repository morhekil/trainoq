import { describe, expect, it } from "vitest";
import { buildReport, renderReport } from "../scripts/physio_report";
import type { DayDoc } from "../shared/days/model";
import { exerciseIdForName } from "../shared/exercises/catalog";

const day: DayDoc = {
  v: 9,
  date: "2026-09-23",
  garminLinks: [],
  totalCalories: 712,
  comments: [
    { id: "late", time: "19:00", text: "Sore after rows", score: { metric: "Back", value: 3 } },
    { id: "early", time: "08:00", text: "", score: { metric: "Back", value: 2 } },
  ],
  events: [
    { id: "walk", title: null, notes: "", entries: [{ kind: "activity", activity: { id: "w", comment: "Easy", effort: "low", segments: [
      { id: "w", exerciseId: exerciseIdForName("Walk"), startedAt: "2026-09-23T12:52:00+10:00", result: { minutes: 47, calories: 126 } },
    ] } }] },
    { id: "gym", title: null, notes: "", entries: [{ kind: "session", session: {
      id: "s", startedAt: "2026-09-23T20:45:00+10:00", endedAt: "2026-09-23T21:35:00+10:00", calories: 174, notes: "Short one",
      warmup: [{ kind: "superset", id: "ss", rounds: [{ id: "r1", type: "warmup" }, { id: "r2", type: "warmup" }],
        members: [
          { id: "m1", exerciseId: exerciseIdForName("Dead bug"), comment: "", params: { perSet: ["reps"] } },
          { id: "m2", exerciseId: "custom-1", comment: "Each side", effort: "high", params: { perSet: ["time"] } },
        ],
        results: [
          { memberId: "m1", roundId: "r1", reps: 8 }, { memberId: "m2", roundId: "r1", time: 30 },
          { memberId: "m1", roundId: "r2", reps: 8 }, { memberId: "m2", roundId: "r2", time: 30 },
        ] }],
      main: [{ kind: "exercise", id: "dl", exerciseId: exerciseIdForName("Deadlift"), comment: "", effort: "max", params: { perSet: ["weight", "reps"] },
        sets: [{ id: "1", type: "working", weight: 60, reps: 5 }, { id: "2", type: "working", weight: 60, reps: 5 }] }],
      cooldown: [],
    } }] },
  ],
};

describe("buildReport", () => {
  const report = buildReport({ days: [{ date: "2026-09-20", doc: { ...day, date: "2026-09-20" } }, { date: day.date, doc: day }], catalog: [{ id: "custom-1", name: "Side plank hold" }] },
    "2026-09-22", "2026-09-24");

  it("covers every date in the range, including days with nothing recorded", () => {
    expect(report.days.map((d) => [d.date, d.label])).toEqual([["2026-09-22", "Tue 22 Sep"], ["2026-09-23", "Wed 23 Sep"], ["2026-09-24", "Thu 24 Sep"]]);
    expect(report.days[0]).toMatchObject({ calories: null, comments: [], events: [] });
  });

  it("keeps comments with their scores in clock order", () => {
    expect(report.days[1].comments).toEqual([
      { time: "08:00", text: "", score: { metric: "Back", value: 2 } },
      { time: "19:00", text: "Sore after rows", score: { metric: "Back", value: 3 } },
    ]);
    expect(report.days[1].calories).toBe(712);
  });

  it("lists events in clock order with sets, effort and comments as the app shows them", () => {
    const [walk, gym] = report.days[1].events;
    expect(walk.parts).toEqual([{ kind: "activity", start: "12:52", name: "Walk", minutes: 47, calories: 126, effort: "low", effortText: "RPE low", comment: "Easy", breakdown: "" }]);
    expect(gym.parts[0]).toMatchObject({ kind: "session", start: "20:45", end: "21:35", minutes: 50, calories: 174, notes: "Short one" });
    const session = gym.parts[0].kind === "session" ? gym.parts[0] : null;
    expect(session?.sections).toEqual([
      { title: "Warm-up", items: [{ superset: true, perfs: [
        { exerciseId: exerciseIdForName("Dead bug"), name: "Dead bug", sets: "warm-up ×8 ×2", effort: null, effortText: "", comment: "" },
        { exerciseId: "custom-1", name: "Side plank hold", sets: "warm-up 30s ×2", effort: "high", effortText: "RPE high", comment: "Each side" },
      ] }] },
      { title: "Main", items: [{ superset: false, perfs: [
        { exerciseId: exerciseIdForName("Deadlift"), name: "Deadlift", sets: "60kg×5 ×2", effort: "max", effortText: "RIR none", comment: "" },
      ] }] },
    ]);
  });

  it("labels the days inside each marked period", () => {
    const marked = buildReport({ days: [], catalog: [] }, "2026-10-08", "2026-10-13",
      [{ from: "2026-10-09", to: "2026-10-10", label: "Sick" }, { from: "2026-10-12", to: "2026-10-12", label: "Climbing trip" }]);
    expect(marked.days.map((d) => d.period)).toEqual([undefined, "Sick", "Sick", undefined, "Climbing trip", undefined]);
  });
});

describe("renderReport", () => {
  it("embeds the report as JSON that cannot close its script tag", () => {
    const html = renderReport('<script id="report" type="application/json">/*REPORT*/</script>', { from: "a", to: "b", generatedAt: "c", days: [{ date: "</script>", label: "", calories: null, comments: [], events: [] }] });
    expect(html).not.toContain("</script><");
    expect(JSON.parse(html.slice(html.indexOf(">") + 1, html.lastIndexOf("</script>"))).days[0].date).toBe("</script>");
  });
});
