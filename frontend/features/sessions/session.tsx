import { useEffect, useState } from "react";
import { formatDateShort } from "../../../shared/days/format";
import { minutesBetween } from "../../../shared/sessions/format";
import { formatSets } from "../../../shared/exercises/format";
import type { Block, MainExercise, SetType, SimpleItem, WorkSet } from "../../../shared/exercises/model";
import type { DayDoc } from "../../../shared/days/model";
import type { Session } from "../../../shared/sessions/model";
import { lastTime } from "../exercises/library";
import {
  addRound,
  addToBlock,
  blockLetter,
  copyMain,
  copySimple,
  findBlock,
  findExercise,
  findSession,
  makeSet,
  move,
  newExercise,
  newSimple,
  nextSetType,
  removeRound,
  setLabels,
  setRoundType,
  type SimpleSection as SimpleSectionKey,
} from "./ops";
import { findRepeatSource } from "./recent";
import { hhmmToIso, isoToHHMM } from "./time";
import { uid } from "../../id";
import { useDayCtx } from "../days/context";
import { Icon } from "../../icons";
import { AutoTextarea, NumberField, Stepper } from "../../inputs";
import { useOverlays, type SheetAction } from "../../overlays";

/** Re-render every `ms` (for live timers). */
function useTick(ms: number, enabled = true) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms, enabled]);
}

function formatDuration(min: number): string {
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m`;
}

// ---------------------------------------------------------------- session

export function SessionCard({ s, index, total }: { s: Session; index: number; total: number }) {
  const { date, update, undoable } = useDayCtx();
  const { openSheet } = useOverlays();
  const active = !s.endedAt;
  useTick(15000, active);

  const minutes = minutesBetween(s.startedAt, s.endedAt ?? new Date().toISOString());
  const up = (fn: (x: Session) => void) => update((d) => fn(findSession(d, s.id)));

  const menu = () => {
    const actions: SheetAction[] = [];
    if (s.endedAt) actions.push({ label: "Resume session", icon: "play", onClick: () => up((x) => (x.endedAt = null)) });
    actions.push({
      label: "Delete session",
      danger: true,
      onClick: () => undoable("Session deleted", (d) => (d.sessions = d.sessions.filter((x) => x.id !== s.id))),
    });
    openSheet({ title: "Session", actions });
  };

  return (
    <section className={`card session ${active ? "active" : ""}`} aria-label="Training session">
      <div className="session-head">
        <div className="session-title">
          <div className="eyebrow">
            {active && <span className="live-dot" aria-hidden="true" />}
            {total > 1 ? `Session ${index + 1}` : "Session"}
            {active ? " · in progress" : ""}
          </div>
          <div className="session-times">
            <input
              type="time"
              className="time-input"
              aria-label="Start time"
              value={isoToHHMM(s.startedAt)}
              onChange={(e) => e.target.value && up((x) => (x.startedAt = hhmmToIso(date, e.target.value)))}
            />
            {s.endedAt && (
              <>
                <span className="muted">–</span>
                <input
                  type="time"
                  className="time-input"
                  aria-label="Finish time"
                  value={isoToHHMM(s.endedAt)}
                  onChange={(e) => e.target.value && up((x) => (x.endedAt = hhmmToIso(date, e.target.value)))}
                />
              </>
            )}
            {(active || minutes > 0) && <span className="muted duration">{formatDuration(minutes)}</span>}
          </div>
        </div>
        {active && (
          <button type="button" className="btn small primary" onClick={() => up((x) => (x.endedAt = new Date().toISOString()))}>
            Finish
          </button>
        )}
        <button type="button" className="icon-btn" aria-label="Session options" onClick={menu}>
          <Icon name="more" />
        </button>
      </div>

      <SimpleSection s={s} section="warmup" title="Warm-up" />
      <MainSection s={s} />
      <SimpleSection s={s} section="cooldown" title="Cool-down" />

      <div className="session-foot">
        <label className="inline-field">
          <span>Active calories</span>
          <NumberField
            value={s.calories}
            decimal={false}
            placeholder="–"
            ariaLabel="Session active calories"
            onChange={(v) => up((x) => (x.calories = v))}
          />
        </label>
        <label className="card-title" htmlFor={`session-notes-${s.id}`}>Session notes</label>
        <AutoTextarea
          id={`session-notes-${s.id}`}
          minRows={1}
          value={s.notes}
          onChange={(e) => up((x) => (x.notes = e.target.value))}
        />
      </div>
    </section>
  );
}

function SectionHead({ title, count, open, onToggle }: { title: string; count: number; open: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="section-head" aria-expanded={open} onClick={onToggle}>
      <h3>{title}</h3>
      {count > 0 && <span className="count">{count}</span>}
      <Icon name={open ? "chevronUp" : "chevronDown"} size={18} className="muted" />
    </button>
  );
}

function RepeatButton({ section, s }: { section: "warmup" | "main" | "cooldown"; s: Session }) {
  const { doc, update, recentVersion } = useDayCtx();
  void recentVersion; // re-evaluate when recent sessions arrive
  const src = findRepeatSource(section, doc, s.id);
  if (!src) return null;
  const n = src.kind === "main" ? src.blocks.reduce((k, b) => k + b.exercises.length, 0) : src.items.filter((i) => i.name.trim()).length;
  const when = src.sameDay ? "earlier session" : formatDateShort(src.date);
  return (
    <button
      type="button"
      className="btn ghost"
      onClick={() =>
        update((d) => {
          const x = findSession(d, s.id);
          if (src.kind === "main") x.main.push(...copyMain(src.blocks));
          else x[section as SimpleSectionKey].push(...copySimple(src.items));
        })
      }
    >
      <Icon name="repeat" size={18} />
      Repeat {when} ({n})
    </button>
  );
}

// ---------------------------------------------------------------- warm-up / cool-down

function SimpleSection({ s, section, title }: { s: Session; section: SimpleSectionKey; title: string }) {
  const { update } = useDayCtx();
  const { openPicker } = useOverlays();
  const [open, setOpen] = useState(true);
  const items = s[section];

  const add = () =>
    openPicker({
      section,
      title: `${title} exercise`,
      onPick: (name) => update((d) => findSession(d, s.id)[section].push(newSimple(name))),
    });

  return (
    <div className="section">
      <SectionHead title={title} count={items.length} open={open} onToggle={() => setOpen(!open)} />
      {open && (
        <>
          {items.length > 0 && (
            <div className="simple-list">
              {items.map((it, i) => (
                <SimpleRow key={it.id} s={s} section={section} it={it} index={i} count={items.length} />
              ))}
            </div>
          )}
          <div className="row-actions">
            <button type="button" className="btn ghost" onClick={add}>
              <Icon name="plus" size={18} />
              Add exercise
            </button>
            {items.length === 0 && <RepeatButton section={section} s={s} />}
          </div>
        </>
      )}
    </div>
  );
}

function SimpleRow({ s, section, it, index, count }: { s: Session; section: SimpleSectionKey; it: SimpleItem; index: number; count: number }) {
  const { update, undoable } = useDayCtx();
  const { openPicker, openSheet } = useOverlays();
  const [noteOpen, setNoteOpen] = useState(false);
  const up = (fn: (x: SimpleItem) => void) =>
    update((d) => {
      const x = findSession(d, s.id)[section].find((y) => y.id === it.id);
      if (x) fn(x);
    });
  const list = (d: DayDoc) => findSession(d, s.id)[section];

  const rename = () => openPicker({ section, title: "Change exercise", initial: it.name, onPick: (name) => up((x) => (x.name = name)) });

  const menu = () =>
    openSheet({
      title: it.name,
      actions: [
        { label: "Change exercise", onClick: rename },
        ...(index > 0 ? [{ label: "Move up", icon: "chevronUp" as const, onClick: () => update((d) => move(list(d), index, -1)) }] : []),
        ...(index < count - 1 ? [{ label: "Move down", icon: "chevronDown" as const, onClick: () => update((d) => move(list(d), index, 1)) }] : []),
        {
          label: "Delete",
          danger: true,
          onClick: () => undoable(`${it.name || "Exercise"} deleted`, (d) => (findSession(d, s.id)[section] = list(d).filter((y) => y.id !== it.id))),
        },
      ],
    });

  return (
    <div className="simple-row">
      <div className="simple-main">
        <button type="button" className={`name-btn ${it.name ? "" : "placeholder"}`} onClick={rename}>
          {it.name || "Choose exercise"}
        </button>
        <input
          className="text reps-input"
          type="text"
          aria-label={`${it.name} reps`}
          placeholder="reps"
          enterKeyHint="done"
          value={it.reps}
          onChange={(e) => up((x) => (x.reps = e.target.value))}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
        <button
          type="button"
          className={`icon-btn ${it.comment ? "on" : ""}`}
          aria-label="Comment"
          aria-pressed={noteOpen || !!it.comment}
          onClick={() => setNoteOpen(!noteOpen)}
        >
          <Icon name="note" size={18} />
        </button>
        <button type="button" className="icon-btn" aria-label={`${it.name} options`} onClick={menu}>
          <Icon name="more" />
        </button>
      </div>
      {(noteOpen || it.comment) && (
        <AutoTextarea
          minRows={1}
          className="comment"
          placeholder="Comment"
          aria-label={`${it.name} comment`}
          autoFocus={noteOpen && !it.comment}
          value={it.comment}
          onChange={(e) => up((x) => (x.comment = e.target.value))}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- main training

function MainSection({ s }: { s: Session }) {
  const { date, update } = useDayCtx();
  const { openPicker } = useOverlays();
  const [open, setOpen] = useState(true);

  const addExercise = () =>
    openPicker({
      section: "main",
      title: "Exercise",
      onPick: (name) => update((d) => findSession(d, s.id).main.push({ id: uid(), exercises: [newExercise(name, date)] })),
    });

  const addSuperset = () =>
    openPicker({
      section: "main",
      title: "Superset – first exercise",
      onPick: (first) => {
        const blockId = uid();
        update((d) => findSession(d, s.id).main.push({ id: blockId, exercises: [newExercise(first, date)] }));
        openPicker({
          section: "main",
          title: "Superset – second exercise",
          onPick: (second) => update((d) => addToBlock(findBlock(findSession(d, s.id), blockId), second, date)),
        });
      },
    });

  return (
    <div className="section">
      <SectionHead title="Main" count={s.main.reduce((n, b) => n + b.exercises.length, 0)} open={open} onToggle={() => setOpen(!open)} />
      {open && (
        <>
          {s.main.map((b, i) => (
            <BlockCard key={b.id} s={s} b={b} index={i} count={s.main.length} />
          ))}
          <div className="row-actions">
            <button type="button" className="btn ghost" onClick={addExercise}>
              <Icon name="plus" size={18} />
              Exercise
            </button>
            <button type="button" className="btn ghost" onClick={addSuperset}>
              <Icon name="plus" size={18} />
              Superset
            </button>
            {s.main.length === 0 && <RepeatButton section="main" s={s} />}
          </div>
        </>
      )}
    </div>
  );
}

const SET_TYPES: [SetType, string][] = [
  ["warmup", "Warm-up"],
  ["working", "Working"],
  ["backoff", "Back-off"],
];

function AddSetButtons({ lastType, onAdd, noun }: { lastType: SetType | undefined; onAdd: (t: SetType) => void; noun: string }) {
  const suggested = lastType ?? "warmup";
  return (
    <div className="add-set" role="group" aria-label={`Add ${noun}`}>
      <span className="add-label">+ {noun}</span>
      <div className="add-set-btns">
        {SET_TYPES.map(([t, label]) => (
          <button key={t} type="button" className={`btn small ${t === suggested ? "primary" : "secondary"}`} onClick={() => onAdd(t)}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function BlockCard({ s, b, index, count }: { s: Session; b: Block; index: number; count: number }) {
  const { date, update, undoable } = useDayCtx();
  const { openPicker, openSheet } = useOverlays();
  const superset = b.exercises.length > 1;
  const letter = blockLetter(index);
  const upBlock = (fn: (x: Block) => void) => update((d) => fn(findBlock(findSession(d, s.id), b.id)));

  const addToSuperset = () =>
    openPicker({
      section: "main",
      title: "Add to superset",
      onPick: (name) => upBlock((x) => addToBlock(x, name, date)),
    });

  const blockMenu = () =>
    openSheet({
      title: `Superset ${letter}`,
      actions: [
        { label: "Add exercise to superset", icon: "plus", onClick: addToSuperset },
        ...(index > 0 ? [{ label: "Move superset up", icon: "chevronUp" as const, onClick: () => update((d) => move(findSession(d, s.id).main, index, -1)) }] : []),
        ...(index < count - 1
          ? [{ label: "Move superset down", icon: "chevronDown" as const, onClick: () => update((d) => move(findSession(d, s.id).main, index, 1)) }]
          : []),
        {
          label: "Delete superset",
          danger: true,
          onClick: () => undoable("Superset deleted", (d) => (findSession(d, s.id).main = findSession(d, s.id).main.filter((x) => x.id !== b.id))),
        },
      ],
    });

  const lastSetType = b.exercises.flatMap((e) => e.sets).at(-1)?.type;

  return (
    <div className={`block ${superset ? "superset" : ""}`}>
      {superset && (
        <div className="block-head">
          <span className="tag">Superset {letter}</span>
          <button type="button" className="icon-btn" aria-label={`Superset ${letter} options`} onClick={blockMenu}>
            <Icon name="more" />
          </button>
        </div>
      )}
      {b.exercises.map((e, j) => (
        <ExerciseEditor
          key={e.id}
          s={s}
          b={b}
          e={e}
          label={superset ? `${letter}${j + 1}` : letter}
          blockIndex={index}
          blockCount={count}
          exIndex={j}
        />
      ))}
      {superset ? (
        <AddSetButtons noun="Round" lastType={lastSetType} onAdd={(t) => upBlock((x) => addRound(x, date, t))} />
      ) : null}
      <button type="button" className="link-btn" onClick={addToSuperset}>
        <Icon name="plus" size={16} />
        {superset ? "Add exercise to superset" : "Make superset – add exercise"}
      </button>
    </div>
  );
}

function ExerciseEditor({
  s,
  b,
  e,
  label,
  blockIndex,
  blockCount,
  exIndex,
}: {
  s: Session;
  b: Block;
  e: MainExercise;
  label: string;
  blockIndex: number;
  blockCount: number;
  exIndex: number;
}) {
  const { date, update, undoable } = useDayCtx();
  const { openPicker, openSheet } = useOverlays();
  const [noteOpen, setNoteOpen] = useState(false);
  const superset = b.exercises.length > 1;
  const last = e.name ? lastTime(e.name, date) : null;
  const labels = setLabels(e.sets);

  const upEx = (fn: (x: MainExercise) => void) => update((d) => fn(findExercise(findBlock(findSession(d, s.id), b.id), e.id)));
  const rename = () => openPicker({ section: "main", title: "Change exercise", initial: e.name, onPick: (name) => upEx((x) => (x.name = name)) });

  const menu = () => {
    const actions: SheetAction[] = [{ label: "Change exercise", onClick: rename }];
    if (superset) {
      if (exIndex > 0)
        actions.push({ label: "Move up", icon: "chevronUp", onClick: () => update((d) => move(findBlock(findSession(d, s.id), b.id).exercises, exIndex, -1)) });
      if (exIndex < b.exercises.length - 1)
        actions.push({ label: "Move down", icon: "chevronDown", onClick: () => update((d) => move(findBlock(findSession(d, s.id), b.id).exercises, exIndex, 1)) });
      actions.push({
        label: "Take out of superset",
        onClick: () =>
          update((d) => {
            const x = findSession(d, s.id);
            const blk = findBlock(x, b.id);
            const [ex] = blk.exercises.splice(exIndex, 1);
            x.main.splice(blockIndex + 1, 0, { id: uid(), exercises: [ex] });
          }),
      });
    } else {
      if (blockIndex > 0) actions.push({ label: "Move up", icon: "chevronUp", onClick: () => update((d) => move(findSession(d, s.id).main, blockIndex, -1)) });
      if (blockIndex < blockCount - 1)
        actions.push({ label: "Move down", icon: "chevronDown", onClick: () => update((d) => move(findSession(d, s.id).main, blockIndex, 1)) });
    }
    actions.push({
      label: "Delete exercise",
      danger: true,
      onClick: () =>
        undoable(`${e.name || "Exercise"} deleted`, (d) => {
          const x = findSession(d, s.id);
          const blk = findBlock(x, b.id);
          blk.exercises = blk.exercises.filter((y) => y.id !== e.id);
          if (!blk.exercises.length) x.main = x.main.filter((y) => y.id !== b.id);
        }),
    });
    openSheet({ title: e.name || "Exercise", actions });
  };

  const upSet = (sid: string, fn: (x: WorkSet) => void) =>
    upEx((x) => {
      const st = x.sets.find((y) => y.id === sid);
      if (st) fn(st);
    });

  return (
    <div className="exercise">
      <div className="ex-head">
        <span className="ex-label">{label}</span>
        <button type="button" className={`name-btn strong ${e.name ? "" : "placeholder"}`} onClick={rename}>
          {e.name || "Choose exercise"}
        </button>
        <button
          type="button"
          className={`icon-btn ${e.comment ? "on" : ""}`}
          aria-label="Comment"
          aria-pressed={noteOpen || !!e.comment}
          onClick={() => setNoteOpen(!noteOpen)}
        >
          <Icon name="note" size={18} />
        </button>
        <button type="button" className="icon-btn" aria-label={`${e.name} options`} onClick={menu}>
          <Icon name="more" />
        </button>
      </div>
      {last && (
        <div className="last-time">
          Last {formatDateShort(last.date)}: {formatSets(last.sets) || "no sets"}
        </div>
      )}
      {(noteOpen || e.comment) && (
        <AutoTextarea
          minRows={1}
          className="comment"
          placeholder="Comment (form, pain, range…)"
          aria-label={`${e.name} comment`}
          autoFocus={noteOpen && !e.comment}
          value={e.comment}
          onChange={(ev) => upEx((x) => (x.comment = ev.target.value))}
        />
      )}
      {e.sets.length > 0 && (
        <div className="sets">
          <div className="set-head" aria-hidden="true">
            <span>Set</span>
            <span>kg</span>
            <span>Reps</span>
            <span />
          </div>
          {e.sets.map((st, k) => (
            <SetRow
              key={st.id}
              label={labels[k]}
              st={st}
              exName={e.name}
              noun={superset ? "round" : "set"}
              onCycle={() =>
                update((d) => {
                  const blk = findBlock(findSession(d, s.id), b.id);
                  setRoundType(blk, k, nextSetType(findExercise(blk, e.id).sets[k].type));
                })
              }
              onWeight={(v) => upSet(st.id, (x) => (x.weight = v))}
              onReps={(v) => upSet(st.id, (x) => (x.reps = v))}
              onRemove={() =>
                undoable(`${superset ? "Round" : "Set"} ${labels[k]} deleted`, (d) => removeRound(findBlock(findSession(d, s.id), b.id), k))
              }
            />
          ))}
        </div>
      )}
      {!superset && <AddSetButtons noun="Set" lastType={e.sets.at(-1)?.type} onAdd={(t) => upEx((x) => x.sets.push(makeSet(x, date, t)))} />}
    </div>
  );
}

const TYPE_NAME: Record<SetType, string> = { warmup: "warm-up", working: "working", backoff: "back-off" };

function SetRow({
  label,
  st,
  exName,
  noun,
  onCycle,
  onWeight,
  onReps,
  onRemove,
}: {
  label: string;
  st: WorkSet;
  exName: string;
  noun: string;
  onCycle: () => void;
  onWeight: (v: number | null) => void;
  onReps: (v: number | null) => void;
  onRemove: () => void;
}) {
  return (
    <div className="set-row">
      <button
        type="button"
        className={`set-badge ${st.type}`}
        aria-label={`${exName} set ${label}, ${TYPE_NAME[st.type]}. Tap to change type`}
        onClick={onCycle}
      >
        {label}
      </button>
      <Stepper value={st.weight} onChange={onWeight} step={2.5} decimal placeholder="–" label={`${exName} ${label} weight`} />
      <Stepper value={st.reps} onChange={onReps} step={1} placeholder="–" label={`${exName} ${label} reps`} />
      <button type="button" className="icon-btn small" aria-label={`Delete ${noun} ${label}`} onClick={onRemove}>
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}
