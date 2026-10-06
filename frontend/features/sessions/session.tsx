import { useEffect, useState, type PointerEvent } from "react";
import { formatDateShort } from "../../../shared/days/format";
import { minutesBetween, itemSets } from "../../../shared/sessions/format";
import { formatSets } from "../../../shared/exercises/format";
import type { PerformedExercise, Section, SessionItem, SetType, Superset, WorkSet } from "../../../shared/exercises/model";
import type { Session } from "../../../shared/sessions/model";
import { removeEventEntry } from "../../../shared/days/model";
import { addMember, addRound, addSet, createSuperset, deleteSuperset, dissolveSuperset, joinPerformance, moveMember, removeMember, removeRound, removeSet, reorderRound, setRoundType, takeOutMember } from "../../../shared/sessions/ops";
import { exerciseName } from "../exercises/catalog";
import { lastTime } from "../exercises/library";
import { blockLetter, copyItems, findItem, findSession, findStandalone, findSuperset, makeSet, move, newExercise, newMember, nextSetType, setLabels } from "./ops";
import { findRepeatSource } from "./recent";
import { hhmmToIso, isoToHHMM } from "./time";
import { uid } from "../../id";
import { useDayCtx } from "../days/context";
import { Icon } from "../../icons";
import { AutoTextarea, NumberField, Stepper } from "../../inputs";
import { useOverlays, type SheetAction } from "../../overlays";

function useTick(ms: number, enabled = true) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(timer);
  }, [ms, enabled]);
}

function formatDuration(min: number): string {
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m`;
}

export function SessionCard({ s, index, total, eventAction }: { s: Session; index: number; total: number; eventAction?: { label: string; onClick: () => void } }) {
  const { date, update, undoable } = useDayCtx();
  const { openSheet } = useOverlays();
  const active = !s.endedAt;
  useTick(15000, active);
  const minutes = minutesBetween(s.startedAt, s.endedAt ?? new Date().toISOString());
  const up = (fn: (session: Session) => void) => update((d) => fn(findSession(d, s.id)));
  const menu = () => openSheet({ title: "Session", actions: [
    ...(eventAction ? [eventAction] : []),
    ...(s.endedAt ? [{ label: "Resume session", icon: "play" as const, onClick: () => up((x) => (x.endedAt = null)) }] : []),
    { label: "Delete session", danger: true, onClick: () => undoable("Session deleted", (d) => removeEventEntry(d, "session", s.id)) },
  ] });

  return (
    <section className={`card session ${active ? "active" : ""}`} aria-label="Training session">
      <div className="session-head">
        <div className="session-title">
          <h2 className="session-heading">{active && <span className="live-dot" aria-hidden="true" />}{total > 1 ? `Session ${index + 1}` : "Session"}{active ? " · in progress" : ""}</h2>
          <div className="session-times">
            <input type="time" className="time-input" aria-label="Start time" value={isoToHHMM(s.startedAt)} onChange={(e) => e.target.value && up((x) => (x.startedAt = hhmmToIso(date, e.target.value)))} />
            {s.endedAt && <><span className="muted">–</span><input type="time" className="time-input" aria-label="Finish time" value={isoToHHMM(s.endedAt)} onChange={(e) => e.target.value && up((x) => (x.endedAt = hhmmToIso(date, e.target.value)))} /></>}
            {(active || minutes > 0) && <span className="muted duration">{formatDuration(minutes)}</span>}
          </div>
        </div>
        {active && <button type="button" className="btn small primary" onClick={() => up((x) => (x.endedAt = new Date().toISOString()))}>Finish</button>}
        <button type="button" className="icon-btn" aria-label="Session options" onClick={menu}><Icon name="more" /></button>
      </div>
      <SectionEditor s={s} section="warmup" title="Warm-up" />
      <SectionEditor s={s} section="main" title="Main" />
      <SectionEditor s={s} section="cooldown" title="Cool-down" />
      <div className="session-foot">
        <label className="inline-field"><span>Active calories</span><NumberField value={s.calories} decimal={false} placeholder="–" ariaLabel="Session active calories" onChange={(v) => up((x) => (x.calories = v))} /></label>
        <label className="card-title" htmlFor={`session-notes-${s.id}`}>Session notes</label>
        <AutoTextarea id={`session-notes-${s.id}`} minRows={1} value={s.notes} onChange={(e) => up((x) => (x.notes = e.target.value))} />
      </div>
    </section>
  );
}

type Drag = { kind: "exercise"; id: string } | { kind: "round"; supersetId: string; roundId: string };
type StartDrag = (drag: Drag, event: PointerEvent<HTMLButtonElement>) => void;

function SectionEditor({ s, section, title }: { s: Session; section: Section; title: string }) {
  const { date, doc, update, recentVersion } = useDayCtx();
  const { openPicker, openSheet } = useOverlays();
  const [open, setOpen] = useState(true);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const source = findRepeatSource(section, doc, s.id);
  void recentVersion;
  const upItems = (fn: (items: SessionItem[]) => void) => update((d) => fn(findSession(d, s.id)[section]));

  const join = (exerciseId: string, supersetId: string) => {
    const exercise = s[section].find((item) => item.id === exerciseId);
    const target = s[section].find((item) => item.id === supersetId);
    if (exercise?.kind !== "exercise" || target?.kind !== "superset") return;
    const matching = exercise.sets.length === target.rounds.length && exercise.sets.every((set, i) => set.type === target.rounds[i].type);
    if (matching) upItems((items) => joinPerformance(items, exerciseId, supersetId));
    else openSheet({
      title: `Align ${exerciseName(exercise.exerciseId)} with superset`,
      description: `Superset rounds: ${target.rounds.map((r) => r.type).join(", ") || "none"}. Exercise sets: ${exercise.sets.map((set) => `${set.type} ${set.weight ?? "–"}kg ×${set.reps ?? "–"}`).join(", ") || "none"}. Appending adds rounds and keeps every recorded value.`,
      actions: [{ label: "Append sets as new rounds", onClick: () => upItems((items) => joinPerformance(items, exerciseId, supersetId, "append")) }],
    });
  };

  useEffect(() => {
    if (!drag) return;
    const keyAt = (point: { clientX: number; clientY: number }) => {
      const key = (document.elementFromPoint(point.clientX, point.clientY)?.closest("[data-drop-key]") as HTMLElement | null)?.dataset.dropKey;
      if (!key) return null;
      if (drag.kind === "exercise") return key === "superset:new" || key.startsWith("superset:add:") ? key : null;
      return key.startsWith(`round:${drag.supersetId}:`) ? key : null;
    };
    let point: { clientX: number; clientY: number } | null = null;
    const onMove = (event: globalThis.PointerEvent) => { point = event; setOver(keyAt(event)); };
    const scroll = setInterval(() => {
      if (!point) return;
      const target = keyAt(point);
      if (target) { setOver(target); return; }
      if (point.clientY > window.innerHeight - 64) window.scrollBy(0, 16);
      else if (point.clientY < 64) window.scrollBy(0, -16);
      setOver(keyAt(point));
    }, 30);
    const onUp = (event: globalThis.PointerEvent) => {
      const key = keyAt(event);
      setDrag(null);
      setOver(null);
      if (!key) return;
      if (drag.kind === "exercise" && key === "superset:new") upItems((items) => createSuperset(items, drag.id, uid()));
      if (drag.kind === "exercise" && key.startsWith("superset:add:")) join(drag.id, key.slice("superset:add:".length));
      if (drag.kind === "round" && key.startsWith(`round:${drag.supersetId}:`)) {
        const index = Number(key.split(":").at(-1));
        update((d) => {
          const superset = findSuperset(findSession(d, s.id), section, drag.supersetId);
          const from = superset.rounds.findIndex((round) => round.id === drag.roundId);
          reorderRound(superset, drag.roundId, index > from ? index - 1 : index);
        });
      }
    };
    const onCancel = () => { setDrag(null); setOver(null); };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp, { once: true });
    document.addEventListener("pointercancel", onCancel, { once: true });
    return () => { clearInterval(scroll); document.removeEventListener("pointermove", onMove); document.removeEventListener("pointerup", onUp); document.removeEventListener("pointercancel", onCancel); };
  }, [drag, s.id, section]);

  const startDrag: StartDrag = (value, event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    setDrag(value);
  };
  const addExercise = () => openPicker({ section, title: `${title} exercise`, onPick: (id) => upItems((items) => items.push(newExercise(id, date, section))) });
  const addSuperset = () => upItems((items) => items.push({ kind: "superset", id: uid(), members: [], rounds: [], results: [] }));
  const count = s[section].reduce((sum, item) => sum + (item.kind === "exercise" ? 1 : item.members.length), 0);
  const when = source?.sameDay ? "earlier session" : source ? formatDateShort(source.date) : "";
  const repeatCount = source?.items.reduce((sum, item) => sum + (item.kind === "exercise" ? 1 : item.members.length), 0) ?? 0;

  return (
    <div className="section">
      <button type="button" className="section-head" aria-expanded={open} onClick={() => setOpen(!open)}><h3>{title}</h3>{count > 0 && <span className="count">{count}</span>}<Icon name={open ? "chevronUp" : "chevronDown"} size={18} className="muted" /></button>
      {open && <>
        {s[section].map((item, index) => item.kind === "superset"
          ? <SupersetCard key={item.id} s={s} section={section} item={item} index={index} count={s[section].length} drag={drag} over={over} startDrag={startDrag} join={join} />
          : <div className="block" key={item.id}><ExerciseEditor s={s} section={section} item={item} member={item} label={blockLetter(index)} index={index} count={s[section].length} memberIndex={0} startDrag={startDrag} /></div>)}
        <div className="row-actions">
          <button type="button" className="btn ghost" onClick={addExercise}><Icon name="plus" size={18} />Add exercise</button>
          <button type="button" className={`btn ghost drop-target ${over === "superset:new" ? "drop-over" : ""}`} data-drop-key="superset:new" onClick={addSuperset}><Icon name="plus" size={18} />Superset{drag?.kind === "exercise" && <span className="drop-caption">Drop to create</span>}</button>
          {s[section].length === 0 && source && <button type="button" className="btn ghost" onClick={() => upItems((items) => items.push(...copyItems(source.items)))}><Icon name="repeat" size={18} />Repeat {when} ({repeatCount})</button>}
        </div>
        {drag && <div className="sr-only" role="status">{over ? "Valid drop target" : "Drag to a labelled drop target"}</div>}
      </>}
    </div>
  );
}

function SupersetCard({ s, section, item, index, count, drag, over, startDrag, join }: {
  s: Session; section: Section; item: Superset; index: number; count: number; drag: Drag | null; over: string | null; startDrag: StartDrag; join: (exerciseId: string, supersetId: string) => void;
}) {
  const { update, undoable } = useDayCtx();
  const { openPicker, openSheet } = useOverlays();
  const letter = blockLetter(index);
  const up = (fn: (superset: Superset) => void) => update((d) => fn(findSuperset(findSession(d, s.id), section, item.id)));
  const add = () => openPicker({ section, title: "Add to superset", onPick: (id) => up((superset) => addMember(superset, newMember(id))) });
  const menu = () => {
    const actions: SheetAction[] = [{ label: "Add exercise to superset", icon: "plus", onClick: add }];
    item.rounds.forEach((round, i) => {
      const label = setLabels(item.rounds)[i];
      if (i > 0) actions.push({ label: `Move round ${label} up`, icon: "chevronUp", onClick: () => up((ss) => reorderRound(ss, round.id, i - 1)) });
      if (i < item.rounds.length - 1) actions.push({ label: `Move round ${label} down`, icon: "chevronDown", onClick: () => up((ss) => reorderRound(ss, round.id, i + 1)) });
      actions.push({ label: `Delete round ${label}`, danger: true, onClick: () => undoable(`Round ${label} deleted`, (d) => removeRound(findSuperset(findSession(d, s.id), section, item.id), round.id)) });
    });
    if (index > 0) actions.push({ label: "Move superset up", icon: "chevronUp", onClick: () => update((d) => move(findSession(d, s.id)[section], index, index - 1)) });
    if (index < count - 1) actions.push({ label: "Move superset down", icon: "chevronDown", onClick: () => update((d) => move(findSession(d, s.id)[section], index, index + 1)) });
    actions.push({ label: "Dissolve superset", onClick: () => undoable("Superset dissolved", (d) => dissolveSuperset(findSession(d, s.id)[section], item.id)) });
    actions.push({ label: "Delete superset", danger: true, onClick: () => undoable("Superset deleted", (d) => deleteSuperset(findSession(d, s.id)[section], item.id)) });
    openSheet({ title: `Superset ${letter}`, actions });
  };
  const dropKey = `superset:add:${item.id}`;
  return (
    <div className="block superset">
      <div className="block-head"><span className="tag">Superset {letter}</span><button type="button" className="icon-btn" aria-label={`Superset ${letter} options`} onClick={menu}><Icon name="more" /></button></div>
      {item.members.map((member, memberIndex) => <ExerciseEditor key={member.id} s={s} section={section} item={item} member={member} label={`${letter}${memberIndex + 1}`} index={index} count={count} memberIndex={memberIndex} startDrag={startDrag} drag={drag} over={over} roundMenu={menu} />)}
      {item.members.length === 0 && <div className="hint">Empty superset. Add an exercise or keep rounds for later.</div>}
      <button type="button" className="btn ghost add-round" onClick={() => up((ss) => addRound(ss, uid(), ss.rounds.at(-1)?.type ?? "warmup"))}><Icon name="plus" size={18} />Round</button>
      <button type="button" className="link-btn" onClick={add}><Icon name="plus" size={16} />Add exercise to superset</button>
      {drag?.kind === "exercise" && <button type="button" className={`drop-target member-drop ${over === dropKey ? "drop-over" : ""}`} data-drop-key={dropKey} onClick={() => join(drag.id, item.id)}>Drop exercise into superset {letter}</button>}
    </div>
  );
}

function ExerciseEditor({ s, section, item, member, label, index, count, memberIndex, startDrag, drag, over, roundMenu }: {
  s: Session; section: Section; item: SessionItem; member: PerformedExercise; label: string; index: number; count: number; memberIndex: number; startDrag: StartDrag; drag?: Drag | null; over?: string | null; roundMenu?: () => void;
}) {
  const { date, update, undoable } = useDayCtx();
  const { openPicker, openSheet } = useOverlays();
  const [noteOpen, setNoteOpen] = useState(false);
  const name = exerciseName(member.exerciseId);
  const sets = itemSets(item, member.id);
  const labels = setLabels(sets);
  const last = lastTime(member.exerciseId, date, section);
  const upMember = (fn: (member: PerformedExercise) => void) => update((d) => {
    const current = findItem(findSession(d, s.id), section, item.id);
    const target = current.kind === "exercise" ? current : current.members.find((m) => m.id === member.id);
    if (target) fn(target);
  });
  const rename = () => openPicker({ section, title: "Change exercise", initial: name, onPick: (id) => upMember((target) => (target.exerciseId = id)) });
  const menu = () => {
    const actions: SheetAction[] = [{ label: "Change exercise", onClick: rename }];
    if (item.kind === "superset") {
      if (memberIndex > 0) actions.push({ label: "Move up", icon: "chevronUp", onClick: () => update((d) => moveMember(findSuperset(findSession(d, s.id), section, item.id), member.id, memberIndex - 1)) });
      if (memberIndex < item.members.length - 1) actions.push({ label: "Move down", icon: "chevronDown", onClick: () => update((d) => moveMember(findSuperset(findSession(d, s.id), section, item.id), member.id, memberIndex + 1)) });
      actions.push({ label: "Take out of superset", onClick: () => update((d) => takeOutMember(findSession(d, s.id)[section], item.id, member.id)) });
    } else {
      if (index > 0) actions.push({ label: "Move up", icon: "chevronUp", onClick: () => update((d) => move(findSession(d, s.id)[section], index, index - 1)) });
      if (index < count - 1) actions.push({ label: "Move down", icon: "chevronDown", onClick: () => update((d) => move(findSession(d, s.id)[section], index, index + 1)) });
      sets.forEach((set, i) => actions.push({ label: `Delete set ${labels[i]}`, danger: true, onClick: () => undoable(`Set ${labels[i]} deleted`, (d) => removeSet(findStandalone(findSession(d, s.id), section, item.id), set.id)) }));
    }
    actions.push({ label: "Delete exercise", danger: true, onClick: () => undoable(`${name} deleted`, (d) => {
      const items = findSession(d, s.id)[section];
      if (item.kind === "superset") removeMember(findSuperset(findSession(d, s.id), section, item.id), member.id);
      else items.splice(items.findIndex((candidate) => candidate.id === item.id), 1);
    }) });
    openSheet({ title: name, actions });
  };
  const upSet = (setId: string, field: "weight" | "reps", value: number | null) => update((d) => {
    const current = findItem(findSession(d, s.id), section, item.id);
    if (current.kind === "exercise") { const set = current.sets.find((candidate) => candidate.id === setId); if (set) set[field] = value; }
    else { const result = current.results.find((candidate) => candidate.memberId === member.id && candidate.roundId === setId); if (result) result[field] = value; }
  });
  return (
    <div className="exercise">
      <div className="ex-head">
        <span className="ex-label">{label}</span>
        <button type="button" className="name-btn strong" onClick={rename}>{name}</button>
        {item.kind === "exercise" && <button type="button" className="drag-handle" aria-label={`Drag ${name}; activate for options`} onPointerDown={(event) => startDrag({ kind: "exercise", id: item.id }, event)} onClick={menu}>⋮⋮</button>}
        <button type="button" className={`icon-btn ${member.comment ? "on" : ""}`} aria-label="Comment" aria-pressed={noteOpen || !!member.comment} onClick={() => setNoteOpen(!noteOpen)}><Icon name="note" size={18} /></button>
        <button type="button" className="icon-btn" aria-label={`${name} options`} onClick={menu}><Icon name="more" /></button>
      </div>
      {last && <div className="last-time">Last {formatDateShort(last.date)}: {formatSets(last.sets) || "no sets"}</div>}
      {(noteOpen || member.comment) && <AutoTextarea minRows={1} className="comment" placeholder="Comment (form, pain, range…)" aria-label={`${name} comment`} autoFocus={noteOpen && !member.comment} value={member.comment} onChange={(event) => upMember((target) => (target.comment = event.target.value))} />}
      {sets.length > 0 && <div className="sets">
        <div className="set-head" aria-hidden="true"><span>{item.kind === "superset" ? "Round" : "Set"}</span><span>kg</span><span>Reps</span><span /></div>
        {item.kind === "superset" && memberIndex === 0 && drag?.kind === "round" && drag.supersetId === item.id && <RoundDrop item={item} index={0} over={over} />}
        {sets.map((set, i) => <div key={set.id}>
          <SetRow label={labels[i]} set={set} name={name} onCycle={() => update((d) => {
            const current = findItem(findSession(d, s.id), section, item.id);
            if (current.kind === "exercise") current.sets[i].type = nextSetType(current.sets[i].type);
            else setRoundType(current, set.id, nextSetType(current.rounds[i].type));
          })} onWeight={(value) => upSet(set.id, "weight", value)} onReps={(value) => upSet(set.id, "reps", value)}
            dragHandle={item.kind === "superset" && memberIndex === 0 ? (event) => startDrag({ kind: "round", supersetId: item.id, roundId: set.id }, event) : undefined} onDragActivate={roundMenu} />
          {item.kind === "superset" && memberIndex === 0 && drag?.kind === "round" && drag.supersetId === item.id && <RoundDrop item={item} index={i + 1} over={over} />}
        </div>)}
      </div>}
      {item.kind === "exercise" && <button type="button" className="btn ghost add-set-button" onClick={() => update((d) => { const ex = findStandalone(findSession(d, s.id), section, item.id); addSet(ex, makeSet(ex, date, section)); })}><Icon name="plus" size={18} />Set</button>}
    </div>
  );
}

function RoundDrop({ item, index, over }: { item: Superset; index: number; over?: string | null }) {
  const key = `round:${item.id}:${index}`;
  return <div className={`round-drop drop-target ${over === key ? "drop-over" : ""}`} data-drop-key={key}>Move round here</div>;
}

const TYPE_NAME: Record<SetType, string> = { warmup: "warm-up", working: "working", backoff: "back-off" };
function SetRow({ label, set, name, onCycle, onWeight, onReps, dragHandle, onDragActivate }: {
  label: string; set: WorkSet; name: string; onCycle: () => void; onWeight: (value: number | null) => void; onReps: (value: number | null) => void; dragHandle?: (event: PointerEvent<HTMLButtonElement>) => void; onDragActivate?: () => void;
}) {
  const [hint, setHint] = useState("");
  useEffect(() => {
    if (!hint) return;
    const timer = setTimeout(() => setHint(""), 1500);
    return () => clearTimeout(timer);
  }, [hint]);
  return <div className="set-row">
    <div className="badge-cell"><button type="button" className={`set-badge ${set.type}`} aria-label={`${name} set ${label}, ${TYPE_NAME[set.type]}. Change type`} onClick={() => { setHint(TYPE_NAME[nextSetType(set.type)]); onCycle(); }}>{label}</button><span className="type-hint" role="status">{hint}</span></div>
    <Stepper value={set.weight ?? null} onChange={onWeight} step={2.5} decimal placeholder="–" label={`${name} ${label} weight`} />
    <Stepper value={set.reps ?? null} onChange={onReps} step={1} placeholder="–" label={`${name} ${label} reps`} />
    {dragHandle ? <button type="button" className="drag-handle round-handle" aria-label={`Drag round ${label}; activate for options`} onPointerDown={dragHandle} onClick={onDragActivate}>⋮⋮</button> : <span />}
  </div>;
}
