import { z } from "zod";
import { dateSchema } from "../../../shared/days/schema";
import type { GarminActivitySummary } from "../../../shared/garmin/fit";

const summarySchema = z.object({
  sourceKey: z.string().regex(/^garmin:\d+:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z:\d+$/),
  sport: z.string().min(1).max(80),
  subSport: z.string().max(80).nullable(),
  title: z.string().min(1).max(200),
  startUtc: z.iso.datetime(),
  localDate: dateSchema.nullable(),
  offsetMinutes: z.number().int().min(-720).max(840).nullable(),
  timerSeconds: z.number().finite().min(0).max(604800).nullable(),
  elapsedSeconds: z.number().finite().min(0).max(604800).nullable(),
  activeCalories: z.number().finite().min(0).max(100000),
}) satisfies z.ZodType<GarminActivitySummary>;

interface GarminRow { summary: string; imported_at: string; target_kind: string | null; target_id: string | null; decision_date: string | null }
export interface GarminCursor { importedAt: string; sourceKey: string }

export async function listGarmin(db: D1Database, from: string, to: string, includeLinked = false, cursor?: GarminCursor) {
  const cursorClause = cursor ? "AND (g.imported_at < ? OR (g.imported_at = ? AND g.source_key < ?))" : "";
  const { results } = await db.prepare(`SELECT g.summary, g.imported_at, l.target_kind, l.target_id, l.date AS decision_date
    FROM garmin_activities g LEFT JOIN garmin_links l ON l.source_key = g.source_key
    WHERE COALESCE(json_extract(g.summary, '$.localDate'), substr(json_extract(g.summary, '$.startUtc'), 1, 10)) BETWEEN ? AND ?
    ${includeLinked ? "" : "AND l.source_key IS NULL"} ${cursorClause}
    ORDER BY g.imported_at DESC, g.source_key DESC LIMIT 21`)
    .bind(from, to, ...(cursor ? [cursor.importedAt, cursor.importedAt, cursor.sourceKey] : [])).all<GarminRow>();
  const items = results.slice(0, 20).map((row) => ({ ...summarySchema.parse(JSON.parse(row.summary)), importedAt: row.imported_at,
    status: row.target_kind ?? "pending", targetId: row.target_id, decisionDate: row.decision_date }));
  const last = items.at(-1);
  return { items, nextCursor: results.length > 20 && last ? { importedAt: last.importedAt, sourceKey: last.sourceKey } : null };
}

export async function allGarmin(db: D1Database): Promise<GarminActivitySummary[]> {
  const { results } = await db.prepare("SELECT summary FROM garmin_activities ORDER BY source_key").all<{ summary: string }>();
  return results.map((row) => summarySchema.parse(JSON.parse(row.summary)));
}

export async function garminSummariesByKeys(db: D1Database, sourceKeys: string[]): Promise<GarminActivitySummary[]> {
  const { results } = await db.prepare(`SELECT summary FROM garmin_activities WHERE source_key IN (${sourceKeys.map(() => "?").join(", ")})`)
    .bind(...sourceKeys).all<{ summary: string }>();
  return results.map((row) => summarySchema.parse(JSON.parse(row.summary)));
}

async function hash(summary: string): Promise<string> {
  const bytes = new TextEncoder().encode(summary);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (n) => n.toString(16).padStart(2, "0")).join("");
}

export async function importGarminSummaries(db: D1Database, candidates: unknown[]) {
  const counts = { inserted: 0, unchanged: 0, updated: 0, rejected: 0 };
  for (const candidate of candidates) {
    const parsed = summarySchema.safeParse(candidate);
    if (!parsed.success) { counts.rejected++; continue; }
    const summary = JSON.stringify(parsed.data);
    const summaryHash = await hash(summary);
    const existing = await db.prepare("SELECT summary_hash FROM garmin_activities WHERE source_key = ?").bind(parsed.data.sourceKey).first<{ summary_hash: string }>();
    if (existing?.summary_hash === summaryHash) { counts.unchanged++; continue; }
    await db.prepare(`INSERT INTO garmin_activities (source_key, summary, summary_hash, imported_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(source_key) DO UPDATE SET summary = excluded.summary, summary_hash = excluded.summary_hash, imported_at = excluded.imported_at`)
      .bind(parsed.data.sourceKey, summary, summaryHash, new Date().toISOString()).run();
    if (existing) counts.updated++; else counts.inserted++;
  }
  return counts;
}
