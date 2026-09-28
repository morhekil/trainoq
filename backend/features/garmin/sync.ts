import { parseGarminFit } from "../../../shared/garmin/fit";
import { readGarminConnection, updateGarminConnection } from "./connection";
import { downloadGarminFits, GarminUnauthorizedError, listGarminActivityIds, refreshGarminTokens } from "./remote";
import { importGarminSummaries } from "./db";

const pageSize = 20;
type Fetcher = typeof fetch;

export async function syncGarminPage(db: D1Database, secret: string, fetcher: Fetcher = fetch) {
  const now = new Date();
  const lockUntil = new Date(now.getTime() + 5 * 60_000).toISOString();
  const claimed = await db.prepare(`UPDATE garmin_connection SET sync_lock_until = ? WHERE id = 1
    AND (sync_lock_until IS NULL OR sync_lock_until < ?)`).bind(lockUntil, now.toISOString()).run();
  if (claimed.meta.changes !== 1) throw new Error("Garmin is disconnected or a sync is already running.");
  try {
    const connection = await readGarminConnection(db, secret);
    if (!connection?.state.tokens || connection.row.status !== "connected") throw new Error("Garmin connection needs sign-in.");
    let tokens = connection.state.tokens;
    async function withToken<T>(request: (current: typeof tokens) => Promise<T>): Promise<T> {
      try { return await request(tokens); }
      catch (error) {
        if (!(error instanceof GarminUnauthorizedError)) throw error;
        tokens = await refreshGarminTokens(tokens, fetcher);
        await updateGarminConnection(db, secret, { ...connection!.state, tokens });
        return request(tokens);
      }
    }
    const offset = connection.row.next_offset;
    const ids = await withToken((current) => listGarminActivityIds(current, offset, pageSize, fetcher));
    const counts = { scanned: ids.length, inserted: 0, unchanged: 0, updated: 0, rejected: 0 };
    for (const id of ids) {
      const existing = await db.prepare("SELECT activity_id FROM garmin_downloads WHERE activity_id = ?").bind(id).first();
      if (existing) { counts.unchanged++; continue; }
      const fits = await withToken((current) => downloadGarminFits(current, id, fetcher));
      let accepted = 0;
      for (const fit of fits) {
        let parsed;
        try { parsed = parseGarminFit(fit); }
        catch { counts.rejected++; continue; }
        counts.rejected += parsed.rejected.length;
        const result = await importGarminSummaries(db, parsed.activities);
        counts.inserted += result.inserted;
        counts.unchanged += result.unchanged;
        counts.updated += result.updated;
        counts.rejected += result.rejected;
        accepted += parsed.activities.length - result.rejected;
      }
      if (accepted) await db.prepare("INSERT INTO garmin_downloads (activity_id, imported_at) VALUES (?, ?)")
        .bind(id, new Date().toISOString()).run();
    }
    const complete = ids.length < pageSize;
    const nextOffset = complete ? 0 : offset + ids.length;
    await db.prepare(`UPDATE garmin_connection SET next_offset = ?, last_sync_at = ?, last_error = NULL,
      status = 'connected', updated_at = ? WHERE id = 1`).bind(nextOffset, new Date().toISOString(), new Date().toISOString()).run();
    return { ...counts, nextOffset, complete };
  } finally {
    await db.prepare("UPDATE garmin_connection SET sync_lock_until = NULL WHERE id = 1").run();
  }
}
