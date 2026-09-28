import type { GarminStoredState } from "./secrets";
import { decryptGarminState, encryptGarminState } from "./secrets";

export interface GarminConnectionRow {
  encrypted_state: string;
  status: "connected" | "mfa" | "error";
  next_offset: number;
  last_sync_at: string | null;
  last_error: string | null;
}

export async function readGarminConnection(db: D1Database, secret: string): Promise<{ row: GarminConnectionRow; state: GarminStoredState } | null> {
  const row = await db.prepare("SELECT encrypted_state, status, next_offset, last_sync_at, last_error FROM garmin_connection WHERE id = 1")
    .first<GarminConnectionRow>();
  return row ? { row, state: await decryptGarminState(row.encrypted_state, secret) } : null;
}

export async function saveGarminConnection(db: D1Database, secret: string, state: GarminStoredState, status: "connected" | "mfa"): Promise<void> {
  const encrypted = await encryptGarminState(state, secret);
  await db.prepare(`INSERT INTO garmin_connection (id, encrypted_state, status, next_offset, last_sync_at, last_error, updated_at)
    VALUES (1, ?, ?, 0, NULL, NULL, ?)
    ON CONFLICT(id) DO UPDATE SET encrypted_state = excluded.encrypted_state, status = excluded.status,
      next_offset = 0, last_sync_at = NULL, last_error = NULL, updated_at = excluded.updated_at`)
    .bind(encrypted, status, new Date().toISOString()).run();
}
