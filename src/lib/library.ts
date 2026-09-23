// Exercise search: starter list + everything logged before (server) + names in local unsynced days.

import { SEED_EXERCISES } from "../../shared/exercises";
import { nameKey, type DayDoc, type ExerciseHistoryEntry, type ExerciseLibrary, type Section, type WorkSet } from "../../shared/types";
import { api } from "./api";
import { cachedDays, onSynced } from "./store";
import { lsGet, lsSet } from "./util";

const LS_KEY = "tq:library";

export interface LibItem {
  key: string;
  name: string;
  aliases: string;
  hint: Section | "any" | null;
  uses: Partial<Record<Section, number>>;
  total: number;
  last: string | null;
}

let lib: ExerciseLibrary = lsGet<ExerciseLibrary>(LS_KEY) ?? { stats: [], history: {} };
let version = 0;
const listeners = new Set<() => void>();

export function subscribeLibrary(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function libraryVersion(): number {
  return version;
}

let lastFetch = 0;
let pending: Promise<void> | null = null;
export function refreshLibrary(force = false): Promise<void> {
  if (pending) return pending;
  if (!force && Date.now() - lastFetch < 5000) return Promise.resolve();
  pending = (async () => {
    try {
      const res = await api("/api/exercises");
      if (res.ok) {
        lib = (await res.json()) as ExerciseLibrary;
        lsSet(LS_KEY, lib);
        lastFetch = Date.now();
        version++;
        listeners.forEach((fn) => fn());
      }
    } catch {
      /* offline – keep cached copy */
    } finally {
      pending = null;
    }
  })();
  return pending;
}

let syncRefreshTimer: ReturnType<typeof setTimeout> | undefined;
onSynced(() => {
  clearTimeout(syncRefreshTimer);
  syncRefreshTimer = setTimeout(() => void refreshLibrary(true), 3000);
});

function namesInDoc(d: DayDoc): [string, Section][] {
  const out: [string, Section][] = [];
  for (const s of d.sessions) {
    s.warmup.forEach((i) => out.push([i.name, "warmup"]));
    s.main.forEach((b) => b.exercises.forEach((e) => out.push([e.name, "main"])));
    s.cooldown.forEach((i) => out.push([i.name, "cooldown"]));
  }
  return out;
}

function buildIndex(extraDocs: DayDoc[]): Map<string, LibItem> {
  const map = new Map<string, LibItem>();
  for (const s of SEED_EXERCISES) {
    map.set(nameKey(s.name), { key: nameKey(s.name), name: s.name, aliases: s.aliases, hint: s.section, uses: {}, total: 0, last: null });
  }
  for (const st of lib.stats) {
    const key = nameKey(st.name);
    const item = map.get(key) ?? { key, name: st.name, aliases: "", hint: null, uses: {}, total: 0, last: null };
    if (!map.has(key)) item.name = st.name;
    item.uses = { ...st.sections };
    item.total = st.count;
    item.last = st.last;
    map.set(key, item);
  }
  // names typed on this device that the server hasn't indexed yet
  for (const d of extraDocs) {
    for (const [name, section] of namesInDoc(d)) {
      const key = nameKey(name);
      if (!key) continue;
      const item = map.get(key) ?? { key, name: name.trim(), aliases: "", hint: null, uses: {}, total: 0, last: null };
      if (!item.last || d.date > item.last) {
        item.uses[section] = Math.max(item.uses[section] ?? 0, 1);
        item.total = Math.max(item.total, 1);
        item.last = d.date;
      }
      map.set(key, item);
    }
  }
  return map;
}

export interface SearchGroup {
  title: string;
  items: LibItem[];
}

export function searchExercises(query: string, section: Section): SearchGroup[] {
  const local = cachedDays()
    .filter((e) => e.dirty)
    .map((e) => e.doc);
  const items = [...buildIndex(local).values()];
  const q = nameKey(query);

  if (!q) {
    const recent = items
      .filter((i) => (i.uses[section] ?? 0) > 0)
      .sort((a, b) => (b.last ?? "").localeCompare(a.last ?? "") || b.total - a.total)
      .slice(0, 25);
    const recentKeys = new Set(recent.map((i) => i.key));
    const hints: (Section | "any")[] = section === "main" ? ["main", "any"] : ["warmup", "cooldown", "any"];
    const suggested = items
      .filter((i) => !recentKeys.has(i.key) && i.hint != null && hints.includes(i.hint))
      .sort((a, b) => (a.hint === section ? 0 : 1) - (b.hint === section ? 0 : 1) || a.name.localeCompare(b.name));
    const suggestedKeys = new Set(suggested.map((i) => i.key));
    const rest = items.filter((i) => !recentKeys.has(i.key) && !suggestedKeys.has(i.key)).sort((a, b) => a.name.localeCompare(b.name));
    return [
      { title: "Recent", items: recent },
      { title: "Suggestions", items: suggested },
      { title: "Other", items: rest },
    ].filter((g) => g.items.length);
  }

  const tokens = q.split(" ");
  const scored: { item: LibItem; score: number }[] = [];
  for (const item of items) {
    const hay = `${item.key} ${item.aliases.toLowerCase()}`;
    if (!tokens.every((t) => hay.includes(t))) continue;
    let score = 0;
    if (item.key === q) score += 1000;
    if (item.key.startsWith(q)) score += 200;
    if (item.key.split(/[\s-]/).some((w) => w.startsWith(tokens[0]))) score += 80;
    if (!tokens.every((t) => item.key.includes(t))) score -= 40; // matched only via alias
    score += Math.min(item.uses[section] ?? 0, 50) * 4 + Math.min(item.total, 50);
    if (item.hint === section) score += 25;
    scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));
  return [{ title: "Matches", items: scored.map((s) => s.item) }];
}

/** Library spelling for a typed name if it matches one exactly (case-insensitive). */
export function canonicalName(typed: string): string {
  const key = nameKey(typed);
  const hit = buildIndex([]).get(key);
  return hit ? hit.name : typed.trim().replace(/\s+/g, " ");
}

/** Most recent main-training entry for an exercise before `beforeDate`. */
export function lastTime(name: string, beforeDate: string): ExerciseHistoryEntry | null {
  const key = nameKey(name);
  if (!key) return null;
  const serverHits = (lib.history[key] ?? []).filter((h) => h.date < beforeDate);
  // include unsynced local days too
  let best: ExerciseHistoryEntry | null = serverHits[0] ?? null;
  for (const e of cachedDays()) {
    const d = e.doc;
    if (d.date >= beforeDate || (best && d.date <= best.date)) continue;
    for (const s of d.sessions)
      for (const b of s.main)
        for (const ex of b.exercises)
          if (nameKey(ex.name) === key && ex.sets.length && (!best || d.date > best.date)) {
            best = { date: d.date, sets: ex.sets.map(({ type, weight, reps }) => ({ type, weight, reps })) };
          }
  }
  return best;
}

/** Suggested values for a fresh set of the given type, based on last time. */
export function suggestedSet(
  name: string,
  beforeDate: string,
  type?: WorkSet["type"],
  strict = false,
): Pick<WorkSet, "type" | "weight" | "reps"> | null {
  const h = lastTime(name, beforeDate);
  if (!h || !h.sets.length) return null;
  const s = (type && h.sets.find((x) => x.type === type)) || (strict ? null : h.sets[0]);
  if (!s) return null;
  return { type: type ?? s.type, weight: s.weight, reps: s.reps };
}
