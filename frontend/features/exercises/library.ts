// Exercise search: starter list + everything logged before (server) + names in local unsynced days.

import { nameKey, type ExerciseContext, type ExerciseHistoryEntry, type ExerciseLibrary, type Section, type WorkSet } from "../../../shared/exercises/model";
import { itemSets } from "../../../shared/sessions/format";
import { allCatalog, exerciseName, setRemoteCatalog } from "./catalog";
import { dayActivities, daySessions, type DayDoc } from "../../../shared/days/model";
import { request, trpc } from "../../api";
import { cachedDays } from "../days/store";
import { lsGet, lsRemove, lsSet } from "../../storage";
import { DEFAULT_PARAMS, sameParams, valuesOf, type ParamSet, type ParamValues } from "../../../shared/exercises/params";

const LS_KEY = "tq:library";

export interface LibItem {
  id: string;
  key: string;
  name: string;
  aliases: string;
  hint: ExerciseContext | "any" | null;
  uses: Partial<Record<ExerciseContext, number>>;
  total: number;
  last: string | null;
}

let lib: ExerciseLibrary = lsGet<ExerciseLibrary>(LS_KEY) ?? { catalog: [], stats: [], history: {}, params: {} };
setRemoteCatalog(lib.catalog ?? []);
export function clearLibrary(): void {
  lib = { catalog: [], stats: [], history: {}, params: {} };
  lastFetch = 0;
  lsRemove(LS_KEY);
  version++;
  listeners.forEach((fn) => fn());
}
let version = 0;
const listeners = new Set<() => void>();

export function subscribeLibrary(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function libraryVersion(): number {
  return version;
}
export function notifyLibrary(): void { version++; listeners.forEach((fn) => fn()); }
export const libraryParams = (): Record<string, ParamSet> => lib.params ?? {};
export const cachedExerciseHistory = (id: string): ExerciseHistoryEntry[] => lib.history[id] ?? [];
export function rememberLibraryParams(exerciseId: string, params: ParamSet): void {
  lib = { ...lib, params: { ...lib.params, [exerciseId]: params } };
  lsSet(LS_KEY, lib);
  notifyLibrary();
}

let lastFetch = 0;
let pending: Promise<void> | null = null;
export function refreshLibrary(force = false): Promise<void> {
  if (pending) return pending;
  if (!force && Date.now() - lastFetch < 5000) return Promise.resolve();
  pending = (async () => {
    try {
      lib = await request(trpc.exercises.library.query());
      setRemoteCatalog(lib.catalog);
      lsSet(LS_KEY, lib);
      lastFetch = Date.now();
      version++;
      listeners.forEach((fn) => fn());
    } catch {
      /* offline – keep cached copy */
    } finally {
      pending = null;
    }
  })();
  return pending;
}

let syncRefreshTimer: ReturnType<typeof setTimeout> | undefined;
export function scheduleLibraryRefresh(): void {
  clearTimeout(syncRefreshTimer);
  syncRefreshTimer = setTimeout(() => void refreshLibrary(true), 3000);
}

function namesInDoc(d: DayDoc): [string, ExerciseContext][] {
  const out: [string, ExerciseContext][] = [];
  for (const s of daySessions(d)) {
    for (const section of ["warmup", "main", "cooldown"] as const)
      s[section].forEach((item) => (item.kind === "exercise" ? [item] : item.members).forEach((e) => out.push([e.exerciseId, section])));
  }
  for (const activity of dayActivities(d)) out.push([activity.exerciseId, "activity"]);
  return out;
}

function buildIndex(extraDocs: DayDoc[]): Map<string, LibItem> {
  const map = new Map<string, LibItem>();
  for (const s of allCatalog()) {
    map.set(s.id, { id: s.id, key: nameKey(s.name), name: s.name, aliases: s.aliases, hint: s.section, uses: {}, total: 0, last: null });
  }
  for (const st of lib.stats) {
    const key = st.exerciseId;
    const item = map.get(key) ?? { id: key, key: nameKey(exerciseName(key)), name: exerciseName(key), aliases: "", hint: null, uses: {}, total: 0, last: null };
    item.uses = { ...st.sections };
    item.total = st.count;
    item.last = st.last;
    map.set(key, item);
  }
  // names typed on this device that the server hasn't indexed yet
  for (const d of extraDocs) {
    for (const [id, section] of namesInDoc(d)) {
      const name = exerciseName(id);
      const key = id;
      if (!key) continue;
      const item = map.get(key) ?? { id, key: nameKey(name), name: name.trim(), aliases: "", hint: null, uses: {}, total: 0, last: null };
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

export function listExercises(query = ""): LibItem[] {
  if (query.trim()) return searchExercises(query, "main").flatMap((group) => group.items);
  return [...buildIndex(cachedDays().filter((entry) => entry.dirty).map((entry) => entry.doc)).values()]
    .sort((a, b) => Number(b.total > 0) - Number(a.total > 0) || (b.last ?? "").localeCompare(a.last ?? "") || a.name.localeCompare(b.name));
}

type SetHistoryEntry = Extract<ExerciseHistoryEntry, { section: Section }>;

export function searchExercises(query: string, section: ExerciseContext): SearchGroup[] {
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
    const hints: (ExerciseContext | "any")[] = section === "activity" ? ["activity"] : section === "main" ? ["main", "any"] : ["warmup", "cooldown", "any"];
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
  // "push up", "push-up" and "pushup" all mean the same exercise
  const flat = (s: string) => s.replace(/[\s-]/g, "");
  const fq = flat(q);
  const scored: { item: LibItem; score: number }[] = [];
  for (const item of items) {
    const hay = `${item.key} ${item.aliases.toLowerCase()}`;
    const flatHay = flat(hay);
    if (!tokens.every((t) => hay.includes(t) || flatHay.includes(flat(t)))) continue;
    const fk = flat(item.key);
    let score = 0;
    if (fk === fq) score += 1000;
    if (fk.startsWith(fq)) score += 200;
    if (item.key.split(/[\s-]/).some((w) => w.startsWith(tokens[0]))) score += 80;
    if (!tokens.every((t) => fk.includes(flat(t)))) score -= 40; // matched only via alias
    score += Math.min(item.uses[section] ?? 0, 50) * 4 + Math.min(item.total, 50);
    if (item.hint === section) score += 25;
    scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));
  return [{ title: "Matches", items: scored.map((s) => s.item) }];
}

/** Most recent entry for an exercise in this section before `beforeDate`. */
export function lastTime(exerciseId: string, beforeDate: string, section: Section, params?: ParamSet): SetHistoryEntry | null {
  const serverHits = (lib.history[exerciseId] ?? []).filter((h): h is SetHistoryEntry => h.date < beforeDate && h.section === section && (!params || sameParams(h.params ?? DEFAULT_PARAMS, params)));
  // include unsynced local days too
  let best: SetHistoryEntry | null = serverHits[0] ?? null;
  for (const e of cachedDays()) {
    const d = e.doc;
    if (d.date >= beforeDate || (best && d.date <= best.date)) continue;
    for (const s of daySessions(d))
      for (const item of s[section])
        for (const ex of item.kind === "exercise" ? [item] : item.members)
          if (ex.exerciseId === exerciseId && (!params || sameParams(ex.params, params)) && itemSets(item, ex.id).length && (!best || d.date > best.date)) {
            best = { date: d.date, section, params: ex.params, ...(ex.setup ? { setup: ex.setup } : {}), sets: itemSets(item, ex.id).map(({ id: _id, type, ...values }) => ({ type, ...values })) };
          }
  }
  return best;
}

/** Setup values from the newest matching record, including an earlier entry on this day. */
export function suggestedSetup(exerciseId: string, date: string, params: ParamSet): ParamValues | undefined {
  if (!params.setup?.length) return undefined;
  let bestDate = "";
  let best: ParamValues | undefined;
  for (const entry of lib.history[exerciseId] ?? []) {
    if (entry.section === "activity" || entry.date > date || entry.date < bestDate || !sameParams(entry.params, params)) continue;
    bestDate = entry.date;
    best = entry.setup;
  }
  for (const { doc } of cachedDays()) {
    if (doc.date > date || doc.date < bestDate) continue;
    for (const session of daySessions(doc)) for (const section of ["warmup", "main", "cooldown"] as const)
      for (const item of session[section]) for (const record of item.kind === "exercise" ? [item] : item.members)
        if (record.exerciseId === exerciseId && sameParams(record.params, params)) {
          bestDate = doc.date;
          best = record.setup;
        }
  }
  return best ? Object.fromEntries(params.setup.map((key) => [key, best?.[key] ?? null])) : undefined;
}

/** Suggested values for a fresh set of the given type, based on last time. */
export function suggestedSet(
  exerciseId: string,
  beforeDate: string,
  section: Section,
  params: ParamSet = DEFAULT_PARAMS,
  type?: WorkSet["type"],
  strict = false,
): (Pick<WorkSet, "type"> & ParamValues) | null {
  const h = lastTime(exerciseId, beforeDate, section, params);
  if (!h || !h.sets.length) return null;
  const s = (type && h.sets.find((x) => x.type === type)) || (strict ? null : h.sets[0]);
  if (!s) return null;
  return { type: type ?? s.type, ...valuesOf(s, params) };
}
