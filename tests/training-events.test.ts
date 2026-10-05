import { describe, expect, it } from "vitest";
import { normalizeDay } from "../shared/days/migrate";
import { daySchema } from "../shared/days/schema";

describe("training events", () => {
  it("wraps v6 records as stable singleton events without changing their contents", () => {
    const session = { id: "session-1", startedAt: "2026-10-02T06:00:00.000Z", endedAt: "2026-10-02T06:30:00.000Z", calories: 90, notes: "Keep these notes", warmup: [], main: [], cooldown: [] };
    const activity = { id: "activity-1", exerciseId: "seed:0170", comment: "Edited", startedAt: "2026-10-02T07:00:00.000Z", garminSourceKey: "garmin:serial:2026-10-02T07:00:00.000Z:0", result: { minutes: 12, calories: 50 } };
    const old = { v: 6 as const, date: "2026-10-02", comments: [{ id: "comment-1", time: "07:05", text: "Still here" }], sessions: [session], activities: [activity], ignoredGarminSourceKeys: [], totalCalories: 220 };

    const migrated = normalizeDay(old);

    expect(migrated).toEqual({ v: 7, date: old.date, comments: old.comments, events: [
      { id: "migrated:session:session-1", title: null, notes: "", entries: [{ kind: "session", session }] },
      { id: "migrated:activity:activity-1", title: null, notes: "", entries: [{ kind: "activity", activity }] },
    ], ignoredGarminSourceKeys: [], totalCalories: 220 });
    expect(daySchema.parse(migrated)).toEqual(migrated);
  });
});
