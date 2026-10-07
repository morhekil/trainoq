// Send the converted PT history (scripts/import_pt_history.py build) through the Worker's tRPC API,
// so the server validates every day and rebuilds exercise_log exactly as for browser saves.
//
//   node scripts/import_pt_history.ts https://trainoq.example.workers.dev history.json
//
// The password comes from TRAINOQ_PASSWORD (`read -rs TRAINOQ_PASSWORD; export TRAINOQ_PASSWORD`). Re-running is safe: days already holding
// the same document and an already merged session are left alone, and any other existing day is
// reported as a conflict instead of being overwritten.
import { readFileSync } from "node:fs";
import { createTRPCClient, httpLink } from "@trpc/client";
import type { AppRouter } from "../backend/router";
import type { DayDoc } from "../shared/days/model";
import type { SessionItem } from "../shared/exercises/model";
import type { ParamSet } from "../shared/exercises/params";

type Sections = { warmup: SessionItem[]; main: SessionItem[]; cooldown: SessionItem[] };
export interface History {
  exercises: { id: string; name: string; params: ParamSet; new: boolean; keepDefault?: boolean }[];
  days: { date: string; doc: DayDoc }[];
  merges: (Sections & { date: string; notes: string })[];
}
export interface Api {
  exercises: {
    library: { query(): Promise<{ catalog: { id: string }[]; params: Record<string, ParamSet> }> };
    create: { mutate(input: { id: string; name: string }): Promise<unknown> };
    setParams: { mutate(input: { exerciseId: string; params: ParamSet; updatedAt: string }): Promise<unknown> };
  };
  days: {
    get: { query(date: string): Promise<{ doc: DayDoc | null; updatedAt: string | null }> };
    save: { mutate(input: { date: string; doc: DayDoc; base: string | null }): Promise<{ ok: boolean }> };
  };
}

const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical((value as Record<string, unknown>)[key])]))
  : value;
const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

export async function importHistory(api: Api, history: History) {
  const result = { saved: [] as string[], unchanged: [] as string[], conflicts: [] as string[] };
  const library = await api.exercises.library.query();
  const known = new Set(library.catalog.map((exercise) => exercise.id));
  for (const exercise of history.exercises) {
    if (!known.has(exercise.id)) await api.exercises.create.mutate({ id: exercise.id, name: exercise.name });
    const current = library.params[exercise.id] ?? { perSet: ["weight", "reps"] };
    if (!exercise.keepDefault && !same(current, exercise.params))
      await api.exercises.setParams.mutate({ exerciseId: exercise.id, params: exercise.params, updatedAt: new Date().toISOString() });
  }
  const save = async (date: string, doc: DayDoc, base: string | null) =>
    (await api.days.save.mutate({ date, doc, base })).ok ? result.saved.push(date) : result.conflicts.push(date);
  for (const { date, doc } of history.days) {
    const current = await api.days.get.query(date);
    if (!current.doc) await save(date, doc, null);
    else (same(current.doc, doc) ? result.unchanged : result.conflicts).push(date);
  }
  for (const merge of history.merges) {
    const current = await api.days.get.query(merge.date);
    const entry = current.doc?.events.flatMap((event) => event.entries).find((item) => item.kind === "session");
    if (!current.doc || entry?.kind !== "session") { result.conflicts.push(merge.date); continue; }
    const session = entry.session;
    const ids = new Set(merge.main.map((item) => item.id));
    if (session.main.some((item) => ids.has(item.id))) { result.unchanged.push(merge.date); continue; }
    for (const section of ["warmup", "main", "cooldown"] as const) session[section] = [...merge[section], ...session[section]];
    session.notes = [session.notes, merge.notes].filter(Boolean).join("\n\n");
    await save(merge.date, current.doc, current.updatedAt);
  }
  return result;
}

async function main([url, file]: string[]) {
  if (!url || !file) throw new Error("usage: node scripts/import_pt_history.ts <app url> <history.json>");
  let cookie = "";
  const api = createTRPCClient<AppRouter>({ links: [httpLink({
    url: new URL("/api/trpc", url).href,
    fetch: async (input, init) => {
      const response = await fetch(input, { ...init, headers: { ...init?.headers as Record<string, string>, cookie } });
      cookie = response.headers.get("set-cookie")?.split(";")[0] ?? cookie;
      return response;
    },
  })] });
  const password = process.env.TRAINOQ_PASSWORD;
  if (!password) throw new Error("Set TRAINOQ_PASSWORD first");
  await api.auth.login.mutate({ password });
  const result = await importHistory(api, JSON.parse(readFileSync(file, "utf8")) as History);
  console.log(`saved ${result.saved.length}, unchanged ${result.unchanged.length}, conflicts ${result.conflicts.length}${result.conflicts.length ? `: ${result.conflicts.join(", ")}` : ""}`);
}

if (import.meta.main) await main(process.argv.slice(2));
