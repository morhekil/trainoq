// Exercise defaults are saved on this device before the independent server sync.
import { DEFAULT_PARAMS, normalizeParams, type ParamSet } from "../../../shared/exercises/params";
import type { ParamTemplate } from "../../../shared/exercises/model";
import { SEED_PARAMS } from "../../../shared/exercises/seed";
import { lsGet, lsRemove, lsSet } from "../../storage";
import { request, trpc } from "../../api";
import { syncDefinition } from "./catalog";
import { forgetLibraryTemplate, libraryParams, libraryTemplates, notifyLibrary, rememberLibraryParams, rememberLibraryTemplate } from "./library";

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

const TEMPLATES_KEY = "tq:param-templates";
type PendingTemplates = { saved: Record<string, ParamTemplate>; deleted: string[] };
let templateChanges: PendingTemplates = lsGet<PendingTemplates>(TEMPLATES_KEY) ?? { saved: {}, deleted: [] };
const persistTemplates = () => { lsSet(TEMPLATES_KEY, templateChanges); notifyLibrary(); };

export function templatesFor(): ParamTemplate[] {
  const hidden = new Set(templateChanges.deleted);
  return [...new Map([...libraryTemplates(), ...Object.values(templateChanges.saved)].map((item) => [item.id, item])).values()]
    .filter((item) => !hidden.has(item.id)).sort((a, b) => a.name.localeCompare(b.name));
}

export function saveLocalTemplate(template: ParamTemplate): void {
  const saved = { ...template, name: template.name.trim(), params: normalizeParams(template.params) };
  templateChanges = { saved: { ...templateChanges.saved, [saved.id]: saved }, deleted: templateChanges.deleted.filter((id) => id !== saved.id) };
  persistTemplates();
  void syncTemplates();
}

export function deleteLocalTemplate(id: string): void {
  const { [id]: _removed, ...saved } = templateChanges.saved;
  templateChanges = { saved, deleted: [...new Set([...templateChanges.deleted, id])] };
  persistTemplates();
  void syncTemplates();
}

let templateSync: Promise<void> | null = null;
export function syncTemplates(): Promise<void> {
  return (templateSync ??= (async () => {
    try {
      for (const template of Object.values(templateChanges.saved)) {
        const stored = await request(trpc.exercises.saveTemplate.mutate(template));
        rememberLibraryTemplate(stored);
        if (templateChanges.saved[template.id] === template) {
          const { [template.id]: _done, ...saved } = templateChanges.saved;
          templateChanges = { ...templateChanges, saved };
          persistTemplates();
        }
      }
      for (const id of templateChanges.deleted) {
        await request(trpc.exercises.deleteTemplate.mutate({ id }));
        forgetLibraryTemplate(id);
        templateChanges = { ...templateChanges, deleted: templateChanges.deleted.filter((value) => value !== id) };
        persistTemplates();
      }
    } catch {
      // A later syncAll retries after reconnect.
    } finally {
      templateSync = null;
    }
  })());
}

export const hasPendingTemplates = () => Object.keys(templateChanges.saved).length > 0 || templateChanges.deleted.length > 0;
export function clearPendingTemplates(): void { templateChanges = { saved: {}, deleted: [] }; lsRemove(TEMPLATES_KEY); }
