import { TRPCError } from "@trpc/server";
import { readConnection } from "./db";
import { withingsConfig } from "./oauth";
import { decryptTokens, encryptTokens } from "./secrets";
import { fetchWeightPage, requestWithingsTokens, WithingsUnauthorizedError } from "./remote";

export async function syncWithings(env: Env, fetcher: typeof fetch = fetch) {
  const config = withingsConfig(env);
  const now = Date.now(), lease = now + 5 * 60_000;
  const claim = await env.DB.prepare("UPDATE withings_connection SET lock_until = ? WHERE id = 1 AND (lock_until IS NULL OR lock_until < ?)").bind(lease, now).run();
  if (claim.meta.changes !== 1) throw new TRPCError({ code: "CONFLICT", message: "Withings is disconnected or a sync is already running. Retry shortly." });
  try {
    const row = await readConnection(env.DB);
    if (!row) throw new Error("Withings is disconnected. Reconnect to resume syncing.");
    let tokens = await decryptTokens(row.encrypted_tokens, env.APP_PASSWORD);
    const refresh = async () => {
      const next = await requestWithingsTokens(config, { grant_type: "refresh_token", refresh_token: tokens.refreshToken }, fetcher);
      if (next.userId !== row.user_id) throw new Error("Withings account changed. Reconnect Withings.");
      const saved = await env.DB.prepare("UPDATE withings_connection SET encrypted_tokens = ? WHERE id = 1 AND lock_until = ?").bind(await encryptTokens(next, env.APP_PASSWORD), lease).run();
      if (saved.meta.changes !== 1) throw new Error("Withings sync lease expired. Retry sync shortly.");
      tokens = next;
    };
    let refreshed = false;
    if (tokens.expiresAt <= now + 60_000) { await refresh(); refreshed = true; }
    let page;
    try { page = await fetchWeightPage(tokens.accessToken, tokens.userId, row.last_update, row.next_offset, fetcher); }
    catch (error) {
      if (!(error instanceof WithingsUnauthorizedError) || refreshed) throw error;
      await refresh();
      page = await fetchWeightPage(tokens.accessToken, tokens.userId, row.last_update, row.next_offset, fetcher);
    }
    if (page.more && page.offset <= row.next_offset) throw new Error("Withings returned an invalid page cursor. Retry sync shortly.");
    const updatedAt = Math.min(row.sweep_update ?? page.updatedAt, page.updatedAt);
    const statements = page.items.map((item) => env.DB.prepare(`INSERT INTO withings_measurements (source_id, user_id, group_id, measured_at, local_date, measurement)
      SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM withings_connection WHERE id = 1 AND lock_until = ?)
      ON CONFLICT(source_id) DO UPDATE SET measured_at = excluded.measured_at, local_date = excluded.local_date, measurement = excluded.measurement`)
      .bind(item.sourceId, item.userId, item.groupId, item.measuredAt, item.localDate, JSON.stringify(item), lease));
    statements.push(env.DB.prepare(`UPDATE withings_connection SET last_update = ?, next_offset = ?, sweep_update = ?, last_sync_at = ?, last_error = NULL
      WHERE id = 1 AND lock_until = ?`).bind(page.more ? row.last_update : Math.max(0, updatedAt - 1), page.more ? page.offset : 0, page.more ? updatedAt : null, new Date().toISOString(), lease));
    const saved = await env.DB.batch(statements);
    if (saved.at(-1)!.meta.changes !== 1) throw new Error("Withings sync lease expired. Retry sync shortly.");
    return { imported: page.items.length, complete: !page.more };
  } catch (error) {
    const message = error instanceof Error && (error.message.startsWith("Withings") || error.message.startsWith("Unable to reach Withings"))
      ? error.message : "Withings sync failed. Retry sync or reconnect Withings.";
    await env.DB.prepare("UPDATE withings_connection SET last_error = ? WHERE id = 1 AND lock_until = ?").bind(message, lease).run();
    throw new TRPCError({ code: "BAD_GATEWAY", message });
  } finally {
    await env.DB.prepare("UPDATE withings_connection SET lock_until = NULL WHERE id = 1 AND lock_until = ?").bind(lease).run();
  }
}
