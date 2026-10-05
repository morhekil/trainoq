// Local-first day storage. Every edit is written to localStorage immediately and
// synced to the server in the background, so a flaky gym connection never loses data.

import { emptyDay, type DayDoc } from "../../../shared/days/model";
import { legacyExerciseNames, normalizeDay, type LegacyDayDoc, type V2DayDoc, type V3DayDoc, type V4DayDoc, type V5DayDoc } from "../../../shared/days/migrate";
import { exerciseIdForName } from "../../../shared/exercises/catalog";
import { clearLocalCatalog, registerExercise, syncDefinitions } from "../exercises/catalog";
import { trpc, request, NetworkError } from "../../api";
import { AuthError } from "../auth/session";
import { lsGet, lsKeys, lsRemove, lsSet } from "../../storage";

export interface StoredDay {
  date: string;
  doc: DayDoc;
  updatedAt: string;
}

export interface Conflict {
  doc: DayDoc | null;
  updatedAt: string | null;
}

export interface Entry {
  doc: DayDoc;
  /** server updatedAt this copy is based on (null = server never had it) */
  base: string | null;
  /** has local changes not yet on the server */
  dirty: boolean;
  rev: number;
  conflict?: Conflict;
}

export type SyncStatus = "saved" | "saving" | "offline" | "error" | "conflict";

const PREFIX = "tq:day:";
const MOVE_PREFIX = "tq:garmin-move:";
const MAX_CACHED_DAYS = 150;

const mem = new Map<string, Entry | null>();
const dayListeners = new Map<string, Set<() => void>>();
const statusListeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const inflight = new Set<string>();
const dirty = new Set<string>();
const conflicts = new Set<string>();
let offline = false;
let failing = false;
let syncedListeners: (() => void)[] = [];

// ---- init: find unsynced days left over from a previous visit
for (const k of lsKeys(PREFIX)) {
  const e = lsGet<Entry>(k);
  const date = k.slice(PREFIX.length);
  if (e?.dirty) dirty.add(date);
  if (e?.conflict) conflicts.add(date);
}

function notifyDay(date: string) {
  dayListeners.get(date)?.forEach((fn) => fn());
}

let status: SyncStatus = computeStatus();
function computeStatus(): SyncStatus {
  if (conflicts.size) return "conflict";
  if (dirty.size && offline) return "offline";
  if (dirty.size && failing && !inflight.size) return "error";
  if (inflight.size || dirty.size) return "saving";
  return "saved";
}
function notifyStatus() {
  const next = computeStatus();
  if (next !== status) {
    status = next;
    statusListeners.forEach((fn) => fn());
  }
}

export function getEntry(date: string): Entry | null {
  if (!mem.has(date)) {
    const entry = lsGet<Entry>(PREFIX + date);
    if (entry) {
      const raw = entry.doc as DayDoc | V5DayDoc | V4DayDoc | LegacyDayDoc | V2DayDoc | V3DayDoc;
      if (raw.v === 1 || raw.v === 2 || raw.v === 3) legacyExerciseNames(raw).forEach((name) => registerExercise(exerciseIdForName(name), name));
      const doc = normalizeDay(raw);
      const conflict = entry.conflict?.doc
        ? (() => {
          const rawConflict = entry.conflict!.doc as DayDoc | V5DayDoc | V4DayDoc | LegacyDayDoc | V2DayDoc | V3DayDoc;
          if (rawConflict.v === 1 || rawConflict.v === 2 || rawConflict.v === 3) legacyExerciseNames(rawConflict).forEach((name) => registerExercise(exerciseIdForName(name), name));
          return { ...entry.conflict, doc: normalizeDay(rawConflict) };
        })()
        : entry.conflict;
      const normalized = { ...entry, doc, conflict };
      if (doc !== entry.doc || conflict?.doc !== entry.conflict?.doc) lsSet(PREFIX + date, normalized);
      mem.set(date, normalized);
    } else mem.set(date, null);
  }
  return mem.get(date) ?? null;
}

function persist(date: string, e: Entry) {
  mem.set(date, e);
  lsSet(PREFIX + date, e);
  if (e.dirty) dirty.add(date);
  else dirty.delete(date);
  if (e.conflict) conflicts.add(date);
  else conflicts.delete(date);
  notifyDay(date);
  notifyStatus();
}

export function subscribeDay(date: string, fn: () => void): () => void {
  let set = dayListeners.get(date);
  if (!set) dayListeners.set(date, (set = new Set()));
  set.add(fn);
  return () => set!.delete(fn);
}

export function subscribeStatus(fn: () => void): () => void {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

export function getStatus(): SyncStatus {
  return status;
}

export function onSynced(fn: () => void): () => void {
  syncedListeners.push(fn);
  return () => {
    syncedListeners = syncedListeners.filter((f) => f !== fn);
  };
}

/** Replace the local copy of a day with an edited version. */
export function setDoc(date: string, doc: DayDoc, autoSync = true): void {
  const prev = getEntry(date);
  persist(date, { doc, base: prev?.base ?? null, dirty: true, rev: (prev?.rev ?? 0) + 1, conflict: prev?.conflict });
  if (autoSync) schedule(date, 800);
}

export function registerGarminMove(fromDate: string, toDate: string, sourceKey: string): void {
  lsSet(MOVE_PREFIX + toDate + ":" + sourceKey, fromDate);
}

function pendingMoves(date: string): { storageKey: string; sourceKey: string; fromDate: string }[] {
  const prefix = MOVE_PREFIX + date + ":";
  return lsKeys(prefix).map((storageKey) => ({ storageKey, sourceKey: storageKey.slice(prefix.length), fromDate: lsGet<string>(storageKey)! }));
}

function schedule(date: string, ms: number) {
  clearTimeout(timers.get(date));
  timers.set(
    date,
    setTimeout(() => void sync(date), ms),
  );
}

/** Take a server copy unless we have unsynced edits of our own. */
function ingest(s: StoredDay) {
  const cur = getEntry(s.date);
  if (cur?.dirty || cur?.conflict) return;
  if (cur && cur.base === s.updatedAt) return;
  persist(s.date, { doc: s.doc, base: s.updatedAt, dirty: false, rev: (cur?.rev ?? 0) + 1 });
}

export function ingestServerDays(days: StoredDay[]): void {
  days.forEach(ingest);
}

export async function loadFromServer(date: string): Promise<void> {
  const cur = getEntry(date);
  if (cur?.dirty) {
    if (!cur.conflict) schedule(date, 0);
    return;
  }
  try {
    const s = await request(trpc.days.get.query(date));
    offline = false;
    if (s.doc && s.updatedAt) ingest({ date, doc: s.doc, updatedAt: s.updatedAt });
    else {
      // server has nothing for this day (never saved, or cleared on another device)
      const e = getEntry(date);
      if (e && !e.dirty && e.base !== null) persist(date, { doc: emptyDay(date), base: null, dirty: false, rev: e.rev + 1 });
    }
  } catch (e) {
    if (e instanceof NetworkError) offline = true;
  }
  notifyStatus();
}

export async function sync(date: string): Promise<void> {
  const e = getEntry(date);
  if (!e || !e.dirty || e.conflict) return;
  if (pendingMoves(date).some(({ fromDate, sourceKey }) => {
    const old = getEntry(fromDate);
    return old?.dirty || old?.conflict || old?.doc.activities.some((activity) => activity.garminSourceKey === sourceKey);
  })) return;
  if (inflight.has(date)) {
    schedule(date, 500);
    return;
  }
  inflight.add(date);
  notifyStatus();
  const rev = e.rev;
  try {
    await syncDefinitions(e.doc);
    const result = await request(trpc.days.save.mutate({ date, doc: e.doc, base: e.base }));
    offline = false;
    if (result.ok) {
      failing = false;
      const cur = getEntry(date)!;
      const stillDirty = cur.rev !== rev;
      persist(date, { ...cur, base: result.updatedAt, dirty: stillDirty });
      if (stillDirty) schedule(date, 300);
      syncedListeners.forEach((fn) => fn());
      for (const key of lsKeys(MOVE_PREFIX)) {
        if (lsGet<string>(key) === date) schedule(key.slice(MOVE_PREFIX.length).slice(0, 10), 0);
      }
      pendingMoves(date).forEach(({ storageKey }) => lsRemove(storageKey));
    } else {
      const cur = getEntry(date)!;
      persist(date, {
        ...cur,
        conflict: result.current ? { doc: result.current.doc, updatedAt: result.current.updatedAt } : { doc: null, updatedAt: null },
      });
    }
  } catch (err) {
    if (err instanceof NetworkError) offline = true;
    else if (!(err instanceof AuthError)) {
      failing = true;
      console.warn("Save failed", err);
    }
  } finally {
    inflight.delete(date);
    notifyStatus();
  }
}

export function syncAll(): void {
  for (const date of dirty) if (!conflicts.has(date)) void sync(date);
}

export function resolveConflict(date: string, keep: "mine" | "theirs"): void {
  const cur = getEntry(date);
  if (!cur?.conflict) return;
  const c = cur.conflict;
  if (keep === "theirs") {
    persist(date, { doc: c.doc ?? emptyDay(date), base: c.updatedAt, dirty: false, rev: cur.rev + 1 });
  } else {
    persist(date, { doc: cur.doc, base: c.updatedAt, dirty: true, rev: cur.rev + 1 });
    schedule(date, 0);
  }
}

export function hasUnsynced(): boolean {
  return dirty.size > 0;
}

/** Recent locally cached days (for offline "repeat last session"). */
export function cachedDays(): Entry[] {
  return lsKeys(PREFIX)
    .map((k) => getEntry(k.slice(PREFIX.length)))
    .filter((e): e is Entry => !!e);
}

export function clearLocalData(): void {
  for (const k of lsKeys(PREFIX)) lsRemove(k);
  for (const k of lsKeys(MOVE_PREFIX)) lsRemove(k);
  mem.clear();
  dirty.clear();
  conflicts.clear();
  lsRemove("tq:catalog");
  clearLocalCatalog();
  notifyStatus();
}

function pruneCache() {
  const dates = lsKeys(PREFIX)
    .map((k) => k.slice(PREFIX.length))
    .sort()
    .reverse();
  for (const d of dates.slice(MAX_CACHED_DAYS)) {
    const e = getEntry(d);
    if (e && !e.dirty && !e.conflict) {
      lsRemove(PREFIX + d);
      mem.delete(d);
    }
  }
}

// ---- background sync triggers
if (typeof window !== "undefined") {
  pruneCache();
  // another tab on this device changed a day: drop our cached copy and re-read it
  window.addEventListener("storage", (ev) => {
    if (!ev.key?.startsWith(PREFIX)) return;
    const date = ev.key.slice(PREFIX.length);
    mem.delete(date);
    const e = getEntry(date);
    if (e?.dirty) dirty.add(date);
    else dirty.delete(date);
    if (e?.conflict) conflicts.add(date);
    else conflicts.delete(date);
    notifyDay(date);
    notifyStatus();
  });
  window.addEventListener("online", () => {
    offline = false;
    syncAll();
  });
  document.addEventListener("visibilitychange", () => {
    syncAll();
  });
  setInterval(() => {
    if (dirty.size) syncAll();
  }, 15000);
  setTimeout(syncAll, 1000);
}
