import { describe, expect, it } from "vitest";
import { daySchema } from "../shared/days/schema";
import { emptyDay, type DayDoc } from "../shared/days/model";

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
});
