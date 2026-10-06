import { useEffect, useState, useSyncExternalStore } from "react";
import { formatDateShort } from "../../../shared/days/format";
import { dayActivities, daySessions } from "../../../shared/days/model";
import { formatSets, formatSetup } from "../../../shared/exercises/format";
import type { ExerciseHistoryEntry } from "../../../shared/exercises/model";
import { PARAMS, paramsKey, paramsName } from "../../../shared/exercises/params";
import { itemSets } from "../../../shared/sessions/format";
import { request, trpc } from "../../api";
import { useOverlays } from "../../overlays";
import { cachedDays } from "../days/store";
import { exerciseName } from "./catalog";
import { cachedExerciseHistory, libraryVersion, listExercises, refreshLibrary, subscribeLibrary } from "./library";
import { deleteLocalTemplate, paramsFor, saveLocalTemplate, setExerciseParams, templatesFor } from "./params";

const useLibraryVersion = () => useSyncExternalStore(subscribeLibrary, libraryVersion);

export function ExercisesView() {
  const [query, setQuery] = useState("");
  const { toast } = useOverlays();
  useLibraryVersion();
  useEffect(() => { void refreshLibrary(); }, []);
  const items = listExercises(query);
  const logged = items.filter((item) => item.total > 0);
  const unlogged = items.filter((item) => item.total === 0);
  const groups = query.trim() ? [{ title: "Matches", items }] : [{ title: "Logged", items: logged }, { title: "Not logged yet", items: unlogged }];
  const templates = templatesFor();
  return <div className="exercises-view">
    <label className="exercise-search-label" htmlFor="exercise-list-search">Search exercises</label>
    <input id="exercise-list-search" className="text exercise-list-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
    {items.length === 0 && <div className="exercise-empty">No exercises match "{query}". <button type="button" className="link-btn" onClick={() => setQuery("")}>Clear search</button></div>}
    {groups.filter((group) => group.items.length).map((group) => <section key={group.title} className="exercise-list-group">
      {!query.trim() && <h2>{group.title}</h2>}
      {group.items.map((item) => <a className="exercise-list-row" key={item.id} href={`#/exercises/${encodeURIComponent(item.id)}`}>
        <span className="exercise-list-name">{item.name}</span>
        <span className="exercise-list-meta"><span className="param-chip">{paramsName(paramsFor(item.id))}</span>{item.last && <> {item.total}× · {formatDateShort(item.last)}</>}</span>
        <span className="exercise-list-chevron" aria-hidden="true">›</span>
      </a>)}
    </section>)}
    {templates.length > 0 && <section className="exercise-list-group">
      <h2>Your templates</h2>
      {templates.map((template) => <div className="template-row" key={template.id}>
        <span><strong>{template.name}</strong><small>{template.params.perSet.map((key) => PARAMS[key].column).join(" · ")}</small></span>
        <button type="button" className="link-btn" aria-label={`Delete template ${template.name}`} onClick={() => {
          deleteLocalTemplate(template.id);
          toast("Template deleted", () => saveLocalTemplate(template));
        }}>Delete</button>
      </div>)}
    </section>}
  </div>;
}

function localHistory(exerciseId: string): ExerciseHistoryEntry[] {
  const entries: ExerciseHistoryEntry[] = [];
  for (const { doc } of cachedDays().filter((entry) => entry.dirty)) {
    for (const session of daySessions(doc)) for (const section of ["warmup", "main", "cooldown"] as const)
      for (const item of session[section]) for (const record of item.kind === "exercise" ? [item] : item.members)
        if (record.exerciseId === exerciseId) entries.push({ date: doc.date, section, params: record.params, ...(record.setup ? { setup: record.setup } : {}), sets: itemSets(item, record.id).map(({ id: _id, ...set }) => set) });
    for (const activity of dayActivities(doc)) if (activity.exerciseId === exerciseId)
      entries.push({ date: doc.date, section: "activity", result: activity.result });
  }
  return entries;
}

function mergedHistory(exerciseId: string, remote: ExerciseHistoryEntry[]): ExerciseHistoryEntry[] {
  const local = localHistory(exerciseId);
  const dirtyDates = new Set(cachedDays().filter((entry) => entry.dirty).map((entry) => entry.doc.date));
  return [...local, ...remote.filter((entry) => !dirtyDates.has(entry.date))].sort((a, b) => b.date.localeCompare(a.date));
}

const sectionName = { warmup: "Warm-up", main: "Main", cooldown: "Cool-down", activity: "Activity" };

export function ExerciseDetail({ id }: { id: string }) {
  useLibraryVersion();
  const { openParams, toast } = useOverlays();
  const name = exerciseName(id);
  const params = paramsFor(id);
  const [remote, setRemote] = useState<ExerciseHistoryEntry[]>(() => cachedExerciseHistory(id));
  const [state, setState] = useState<"loading" | "done" | "offline">("loading");
  useEffect(() => {
    let active = true;
    void request(trpc.exercises.history.query({ exerciseId: id }))
      .then((entries) => { if (active) { setRemote(entries); setState("done"); } })
      .catch(() => { if (active) setState("offline"); });
    return () => { active = false; };
  }, [id]);
  const entries = mergedHistory(id, remote);
  const grouped = new Map<string, ExerciseHistoryEntry[]>();
  for (const entry of entries) {
    const key = entry.section === "activity" ? "activity" : paramsKey(entry.params);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(entry);
  }
  const change = () => openParams({
    exerciseName: name, current: params,
    note: `Applies to future ${name} entries. Earlier entries keep their parameters.`,
    onApply: (next) => {
      setExerciseParams(id, next);
      toast(`${name} now records ${paramsName(next).toLowerCase()}`, () => setExerciseParams(id, params));
    },
  });
  return <div className="exercise-detail">
    <section className="card exercise-detail-section">
      <h2>Parameters</h2>
      <div className="exercise-detail-params"><span>{paramsName(params)}</span><button type="button" className="link-btn" onClick={change}>Change ›</button></div>
    </section>
    <section className="card exercise-detail-section">
      <h2>History</h2>
      {state === "loading" && <p>Loading history…</p>}
      {state === "offline" && <p>Offline. Showing recent entries saved on this phone.</p>}
      {entries.length === 0 && state !== "loading" && <p>No entries yet. Add {name} to a session and it appears here.</p>}
      {[...grouped].map(([key, group]) => <div className="exercise-history-group" key={key}>
        <h3>{key === "activity" ? "Activity" : paramsName((group[0] as Extract<ExerciseHistoryEntry, { params: unknown }>).params)} <span>{group.length} {group.length === 1 ? "entry" : "entries"}</span></h3>
        {group.map((entry, index) => <div className="exercise-history-entry" key={`${entry.date}-${entry.section}-${index}`}>
          <strong>{formatDateShort(entry.date)} · {sectionName[entry.section]}{entry.section !== "activity" && formatSetup(entry.setup, entry.params) ? ` (${formatSetup(entry.setup, entry.params)})` : ""}</strong>
          <span>{entry.section === "activity"
            ? [entry.result.minutes != null ? `${entry.result.minutes} min` : null, entry.result.calories != null ? `${entry.result.calories} cal` : null].filter(Boolean).join(" · ") || "No values"
            : formatSets(entry.sets, entry.params) || "No values"}</span>
        </div>)}
      </div>)}
    </section>
  </div>;
}
