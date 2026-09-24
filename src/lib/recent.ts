// Finds the most recent earlier session with a given section filled in, for "Repeat" buttons.

import type { Block, DayDoc, SimpleItem } from "../../shared/types";
import { request, trpc } from "./api";
import { cachedDays, ingestServerDays } from "./store";

const fetched = new Set<string>();

/** Pull recent days with sessions into the local cache (once per date per page load). */
export async function loadRecentSessions(beforeDate: string): Promise<boolean> {
  if (fetched.has(beforeDate)) return false;
  fetched.add(beforeDate);
  try {
    const days = await request(trpc.days.list.query({ before: beforeDate, withSessions: true, limit: 14 }));
    ingestServerDays(days);
    return true;
  } catch {
    fetched.delete(beforeDate);
    return false;
  }
}

export type RepeatSource =
  | { date: string; sameDay: boolean; kind: "simple"; items: SimpleItem[] }
  | { date: string; sameDay: boolean; kind: "main"; blocks: Block[] };

function pickFrom(doc: DayDoc, section: "warmup" | "main" | "cooldown", beforeSessionId?: string): RepeatSource | null {
  let sessions = doc.sessions;
  if (beforeSessionId) {
    const idx = sessions.findIndex((s) => s.id === beforeSessionId);
    sessions = idx >= 0 ? sessions.slice(0, idx) : [];
  }
  for (let i = sessions.length - 1; i >= 0; i--) {
    const s = sessions[i];
    if (section === "main") {
      if (s.main.some((b) => b.exercises.some((e) => e.name.trim()))) return { date: doc.date, sameDay: !!beforeSessionId, kind: "main", blocks: s.main };
    } else if (s[section].some((x) => x.name.trim())) {
      return { date: doc.date, sameDay: !!beforeSessionId, kind: "simple", items: s[section] };
    }
  }
  return null;
}

export function findRepeatSource(section: "warmup" | "main" | "cooldown", current: DayDoc, sessionId: string): RepeatSource | null {
  const same = pickFrom(current, section, sessionId);
  if (same) return same;
  const earlier = cachedDays()
    .map((e) => e.doc)
    .filter((d) => d.date < current.date && d.sessions.length)
    .sort((a, b) => b.date.localeCompare(a.date));
  for (const d of earlier) {
    const hit = pickFrom(d, section);
    if (hit) return hit;
  }
  return null;
}
