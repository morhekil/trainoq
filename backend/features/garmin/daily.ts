import { emptyDay } from "../../../shared/days/model";
import { getDay, putDay } from "../days/db";
import type { GarminTokens } from "./connect";
import { getGarminDailyCalories, getGarminDisplayName } from "./remote";

// ponytail: a week covers a watch left unsynced on a trip; longer gaps stay manual.
const lookbackDays = 7;
const refetchMs = 30 * 60_000;
const settleMs = 12 * 3_600_000;
type Fetcher = typeof fetch;
type WithToken = <T>(request: (tokens: GarminTokens) => Promise<T>) => Promise<T>;

interface DailyRow { date: string; written_calories: number | null; settled: number; fetched_at: string }

/**
 * Put Garmin's active calories into each finished day's `totalCalories` unless the day holds a total Garmin did not write.
 * Unfinished days are never written, so today's edits and offline drafts do not meet a Worker revision.
 */
export async function syncGarminDailyCalories(db: D1Database, withToken: WithToken, fetcher: Fetcher = fetch): Promise<void> {
  const now = Date.now();
  const dates = Array.from({ length: lookbackDays }, (_, i) => new Date(now - i * 86_400_000).toISOString().slice(0, 10));
  const { results } = await db.prepare(`SELECT date, written_calories, settled, fetched_at FROM garmin_daily
    WHERE date IN (${dates.map(() => "?").join(",")})`).bind(...dates).all<DailyRow>();
  const rows = new Map(results.map((row) => [row.date, row]));
  const due = dates.filter((date) => {
    const row = rows.get(date);
    return !row || (!row.settled && now - Date.parse(row.fetched_at) >= refetchMs);
  });
  if (!due.length) return;
  const displayName = await withToken((tokens) => getGarminDisplayName(tokens, fetcher));
  for (const date of due) {
    const summary = await withToken((tokens) => getGarminDailyCalories(tokens, displayName, date, fetcher));
    let written = rows.get(date)?.written_calories ?? null;
    if (summary?.complete) {
      const day = await getDay(db, date);
      const doc = day?.doc ?? emptyDay(date);
      if (doc.totalCalories === null || doc.totalCalories === written) {
        if (doc.totalCalories !== summary.activeCalories) {
          const saved = await putDay(db, date, { ...doc, totalCalories: summary.activeCalories }, day?.updatedAt ?? null);
          if (!saved.ok) continue; // A browser save won; the next sync retries this day.
        }
        written = summary.activeCalories;
      }
    }
    const settled = summary?.complete && now >= Date.parse(summary.endUtc) + settleMs ? 1 : 0;
    await db.prepare(`INSERT INTO garmin_daily (date, written_calories, settled, fetched_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET written_calories = excluded.written_calories, settled = excluded.settled, fetched_at = excluded.fetched_at`)
      .bind(date, written, settled, new Date(now).toISOString()).run();
  }
}
