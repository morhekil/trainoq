// Exercise defaults are saved on this device before the independent server sync.
import { DEFAULT_PARAMS, normalizeParams, type ParamSet } from "../../../shared/exercises/params";
import { SEED_PARAMS } from "../../../shared/exercises/seed";
import { lsGet, lsRemove, lsSet } from "../../storage";
import { request, trpc } from "../../api";
import { syncDefinition } from "./catalog";
import { libraryParams, notifyLibrary, rememberLibraryParams } from "./library";

const KEY = "tq:params";
type Change = { params: ParamSet; updatedAt: string };
let pending = lsGet<Record<string, Change>>(KEY) ?? {};
let lastStamp = Math.max(0, ...Object.values(pending).map((change) => new Date(change.updatedAt).getTime()));

export function paramsFor(exerciseId: string): ParamSet {
  return pending[exerciseId]?.params ?? libraryParams()[exerciseId] ?? SEED_PARAMS[exerciseId] ?? DEFAULT_PARAMS;
}

export function setExerciseParams(exerciseId: string, params: ParamSet): void {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  pending = { ...pending, [exerciseId]: { params: normalizeParams(params), updatedAt: new Date(lastStamp).toISOString() } };
  lsSet(KEY, pending);
  notifyLibrary();
  void syncParams();
}

let running: Promise<void> | null = null;
export function syncParams(): Promise<void> {
  return (running ??= (async () => {
    try {
      for (const [exerciseId, change] of Object.entries(pending)) {
        await syncDefinition(exerciseId);
        const stored = await request(trpc.exercises.setParams.mutate({ exerciseId, ...change }));
        rememberLibraryParams(exerciseId, stored.params);
        if (pending[exerciseId]?.updatedAt !== change.updatedAt) continue;
        const { [exerciseId]: _done, ...rest } = pending;
        pending = rest;
        lsSet(KEY, pending);
      }
    } catch {
      // A later syncAll retries after reconnect.
    } finally {
      running = null;
    }
  })());
}

export const hasPendingParams = () => Object.keys(pending).length > 0;
export function clearPendingParams(): void { pending = {}; lsRemove(KEY); }
