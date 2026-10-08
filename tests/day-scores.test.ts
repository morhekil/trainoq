import { describe, expect, it } from "vitest";
import { daySchema } from "../shared/days/schema";
import { emptyDay, recentMetrics, type DayDoc } from "../shared/days/model";
import { daySummary, dayToText } from "../shared/days/format";

function backDay(): DayDoc {
  const day = emptyDay("2026-10-02");
  day.comments = [
    { id: "morning", time: "08:00", text: "", score: { metric: "Back", value: 1 } },
    { id: "run", time: "17:05", text: "Hurt on both sides after 30 minutes", score: { metric: "Back", value: 3 } },
    { id: "note", time: "20:00", text: "Plain comment" },
  ];
  return day;
}

describe("comment scores", () => {
  it("keeps a 0–5 score with an optional comment", () => {
    expect(daySchema.parse(backDay())).toEqual(backDay());
  });

  it("rejects scores outside 0–5, fractions and unnamed metrics", () => {
    for (const score of [{ metric: "Back", value: 6 }, { metric: "Back", value: -1 }, { metric: "Back", value: 2.5 }, { metric: " ", value: 2 }]) {
      const day = backDay();
      day.comments[0].score = score;
      expect(daySchema.safeParse(day).success, JSON.stringify(score)).toBe(false);
    }
  });

  it("shares each score after the comment time, out of 5", () => {
    expect(dayToText(backDay())).toBe([
      "Fri 2 Oct 2026", "",
      "Comment 08:00 · Back 1/5", "",
      "Comment 17:05 · Back 3/5", "Hurt on both sides after 30 minutes", "",
      "Comment 20:00", "Plain comment",
    ].join("\n"));
  });

  it("offers each metric scored between two dates once, latest first", () => {
    const day = (date: string, ...metrics: [string, string][]): DayDoc => ({ ...emptyDay(date),
      comments: metrics.map(([time, metric], i) => ({ id: `${date}-${i}`, time, text: "", score: { metric, value: 1 } })) });
    const days = [
      day("2026-10-08", ["08:00", "Back"]),
      day("2026-09-24", ["08:00", "Knee"]),
      day("2026-10-07", ["21:00", "Neck"], ["08:00", "back"]),
      day("2026-09-25", ["08:00", "Hip"]),
      day("2026-10-09", ["08:00", "Shoulder"]),
      { ...emptyDay("2026-10-06"), comments: [{ id: "plain", time: "08:00", text: "No score" }] },
    ];
    expect(recentMetrics(days, "2026-09-25", "2026-10-08")).toEqual(["Back", "Neck", "Hip"]);
  });

  it("summarises each metric's range for the history list", () => {
    const day = backDay();
    expect(daySummary(day)).toBe("Back 1–3");
    day.comments.push({ id: "hip", time: "07:00", text: "", score: { metric: "Hip", value: 0 } }, { id: "late", time: "22:00", text: "", score: { metric: "back", value: 2 } });
    expect(daySummary(day)).toBe("Hip 0 · Back 1–3");
  });
});
