import type { StoredDay } from "../days/db";
import { inputDaySchema } from "../../../shared/days/schema";

export async function exportAll(db: D1Database): Promise<StoredDay[]> {
  const { results } = await db.prepare("SELECT date, doc, updated_at FROM days ORDER BY date").all<{ date: string; doc: string; updated_at: string }>();
  return results.map((r) => ({ date: r.date, doc: inputDaySchema.parse(JSON.parse(r.doc)), updatedAt: r.updated_at }));
}
