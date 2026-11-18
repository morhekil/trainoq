import type { WeightMeasurement } from "../../../shared/withings/model";

export interface WithingsConnection {
  user_id: string; encrypted_tokens: string; last_update: number; next_offset: number; sweep_update: number | null;
  last_sync_at: string | null; last_error: string | null; lock_until: number | null;
}
export const readConnection = (db: D1Database) => db.prepare("SELECT * FROM withings_connection WHERE id = 1").first<WithingsConnection>();

export type WeightCursor = { measuredAt: string; sourceId: string };
export async function listWeights(db: D1Database, input: { from?: string; to?: string; limit?: number; cursor?: WeightCursor } = {}) {
  const { from = "0000-00-00", to = "9999-99-99", limit = 50, cursor } = input;
  const rows = await db.prepare(`SELECT measurement FROM withings_measurements WHERE local_date >= ? AND local_date <= ?
    ${cursor ? "AND (measured_at < ? OR (measured_at = ? AND source_id < ?))" : ""}
    ORDER BY measured_at DESC, source_id DESC LIMIT ?`)
    .bind(from, to, ...(cursor ? [cursor.measuredAt, cursor.measuredAt, cursor.sourceId] : []), limit + 1).all<{ measurement: string }>();
  const items = rows.results.slice(0, limit).map((row) => JSON.parse(row.measurement) as WeightMeasurement);
  const last = items.at(-1);
  return { items, nextCursor: rows.results.length > limit && last ? { measuredAt: last.measuredAt, sourceId: last.sourceId } : null };
}
export async function allWeights(db: D1Database): Promise<WeightMeasurement[]> {
  const { results } = await db.prepare("SELECT measurement FROM withings_measurements ORDER BY measured_at, source_id").all<{ measurement: string }>();
  return results.map((row) => JSON.parse(row.measurement) as WeightMeasurement);
}
