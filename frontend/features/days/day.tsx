import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { activityName, activityStart, activityTotals, addEventEntry, combineActivities, dayActivities, daySessions, detachEventEntry, emptyDay, linkedKeys, mergeEvents, removeEventEntry, splitActivity, type Activity, type DayComment, type DayDoc, type EventEntry, type Segment, type TrainingEvent } from "../../../shared/days/model";
import { dayToText } from "../../../shared/days/format";
import { activityTime, orderedDayEvents, orderedDayRecords } from "../../../shared/days/timeline";
import { useDay } from "./hooks";
import { libraryVersion, refreshLibrary, subscribeLibrary } from "../exercises/library";
import { exerciseName } from "../exercises/catalog";
import { newSession } from "../sessions/ops";
import { loadRecentSessions } from "../sessions/recent";
import { getEntry, resolveConflict } from "./store";
import { todayLocal } from "./dates";
import { atClock, clockTime, deviceOffset, nowLocal, withClock } from "../../../shared/days/time";
import { uid } from "../../id";
import { DayContext, useDayCtx, type DayCtx } from "./context";
import { Icon } from "../../icons";
import { AutoTextarea, NumberField } from "../../inputs";
import { useOverlays } from "../../overlays";
import { Modal } from "../../modal";
import { SessionCard } from "../sessions/session";
import { suggestedRecordingGroups } from "../../../shared/garmin/decisions";
import { activityMeasurements, eventMeasurements } from "../../../shared/days/summary";
import type { GarminActivitySummary } from "../../../shared/garmin/fit";
import { formatNum } from "../../../shared/exercises/format";
import type { ActivityResult } from "../../../shared/exercises/model";
import { EffortPicker } from "../exercises/effort";
import { request, trpc } from "../../api";

export function DayView({ date }: { date: string }) {
  useSyncExternalStore(subscribeLibrary, libraryVersion);
  const { doc, entry, update, replace } = useDay(date);
  const { openSheet, toast } = useOverlays();
  const [recentVersion, setRecentVersion] = useState(0);
  const [sources, setSources] = useState<Map<string, GarminActivitySummary>>(new Map());
  const sourceKeys = linkedKeys(doc).flatMap((part) => part.sourceKey ? [part.sourceKey] : []).sort().join("|");

  useEffect(() => {
    void refreshLibrary();
    void loadRecentSessions(date).then((changed) => changed && setRecentVersion((v) => v + 1));
  }, [date]);

  useEffect(() => {
    let current = true;
    setSources(new Map());
    if (sourceKeys) void request(trpc.garmin.summaries.query({ sourceKeys: sourceKeys.split("|") }))
      .then((items) => { if (current) setSources(new Map(items.map((item) => [item.sourceKey, item]))); })
      .catch(() => {});
    return () => { current = false; };
  }, [sourceKeys]);

  const undoable = useCallback(
    (message: string, fn: (d: DayDoc) => void, onUndo?: () => void) => {
      const prev = getEntry(date)?.doc ?? emptyDay(date);
      update(fn);
      toast(message, () => { replace(prev); onUndo?.(); });
    },
    [date, update, replace, toast],
  );

  const ctx = useMemo<DayCtx>(() => ({ date, doc, update, undoable, recentVersion }), [date, doc, update, undoable, recentVersion]);
  const active = daySessions(doc).some((s) => !s.endedAt);
  const records = orderedDayRecords(doc);
  const sessionIndices = new Map(records.filter((record) => record.kind === "session").map((record) => [record.s.id, record.index]));
  const recordingGroups = suggestedRecordingGroups(doc);
  const actionFor = (event: TrainingEvent, entry: EventEntry): EventAction | undefined => {
    const id = entry.kind === "session" ? entry.session.id : entry.activity.id;
    if (event.entries.length > 1) return { label: "Remove from training event", onClick: () => undoable("Part removed from training event", (day) => detachEventEntry(day, event.id, entry.kind, id)) };
    if (doc.events.length < 2 || event.title || event.notes || event.summaryOverrides) return undefined;
    const candidates = orderedDayEvents(doc).flatMap((item) => item.kind === "event" && item.event.id !== event.id && !item.event.summaryOverrides ? [item.event] : []);
    return { label: "Add to training event", onClick: () => openSheet({
      title: "Add to training event",
      description: "Choose the event for this part. Its saved values and Garmin link stay with it.",
      actions: candidates.map((item) => ({
        label: `${eventLabel(item)} · ${item.entries.length} ${item.entries.length === 1 ? "part" : "parts"}`,
        onClick: () => undoable("Training events combined", (day) => mergeEvents(day, [item.id, event.id])),
      })),
    }) };
  };

  const start = () =>
    update((d) => {
      const s = newSession();
      if (date !== todayLocal()) {
        // logging a past day: use this time of day on that date, and don't leave it running
        const time = clockTime(s.startedAt);
        s.startedAt = atClock(date, time, deviceOffset(date, time));
        s.endedAt = s.startedAt;
      }
      addEventEntry(d, { kind: "session", session: s });
    });

  return (
    <DayContext.Provider value={ctx}>
      {entry?.conflict && <ConflictBanner date={date} local={doc} other={entry.conflict.doc} />}
      {recordingGroups.map((ids) => {
        const count = ids.reduce((total, id) => total + (doc.events.find((event) => event.id === id)?.entries.length ?? 0), 0);
        return <button key={ids[0]} type="button" className="btn big secondary recording-suggestion" onClick={() => undoable("Recording parts grouped", (day) => mergeEvents(day, ids))}>
          Group {count} parts from one Garmin recording
        </button>;
      })}
      {orderedDayEvents(doc).map((record) => record.kind === "comment"
        ? <CommentCard key={`comment-${record.comment.id}`} comment={record.comment} />
        : record.event.entries.length > 1 || record.event.title || record.event.notes
          ? <TrainingEventCard key={record.event.id} event={record.event} sources={sources} sessionIndices={sessionIndices} totalSessions={daySessions(doc).length} actionFor={actionFor} />
          : <EventPart key={record.event.id} eventId={record.event.id} entry={record.event.entries[0]} sources={sources} sessionIndices={sessionIndices} totalSessions={daySessions(doc).length} action={actionFor(record.event, record.event.entries[0])} />)}
      {!active && (
        <button type="button" className="btn big primary start-btn" onClick={start}>
          <Icon name="play" size={18} />
          {daySessions(doc).length ? "Start another session" : "Start training session"}
        </button>
      )}
      <AddCommentCard />
      <AddActivityCard />
      <TotalsCard />
    </DayContext.Provider>
  );
}

type EventAction = { label: string; onClick: () => void };

function eventLabel(event: TrainingEvent): string {
  if (event.title?.trim()) return event.title.trim();
  const first = event.entries[0];
  if (first.kind === "session") return `Session at ${clockTime(first.session.startedAt)}`;
  return `${activityName(first.activity, exerciseName)} at ${activityTime(first.activity)}`;
}

/** Moves focus once the change has rendered, e.g. to the card that replaced the one acted on. */
const focusLater = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.focus());

function EventPart({ eventId, entry, sources, sessionIndices, totalSessions, action }: { eventId: string; entry: EventEntry; sources: ReadonlyMap<string, GarminActivitySummary>; sessionIndices: Map<string, number>; totalSessions: number; action?: EventAction }) {
  if (entry.kind === "session") return <SessionCard s={entry.session} index={sessionIndices.get(entry.session.id) ?? 0} total={totalSessions} eventAction={action} />;
  return entry.activity.segments.length > 1
    ? <CombinedActivityCard a={entry.activity} eventId={eventId} sources={sources} eventAction={action} />
    : <ActivityCard a={entry.activity} eventAction={action} />;
}

function TrainingEventCard({ event, sources, sessionIndices, totalSessions, actionFor }: { event: TrainingEvent; sources: ReadonlyMap<string, GarminActivitySummary>; sessionIndices: Map<string, number>; totalSessions: number; actionFor: (event: TrainingEvent, entry: EventEntry) => EventAction | undefined }) {
  const { doc, update, undoable } = useDayCtx();
  const measurements = eventMeasurements(doc, event, sources);
  const combinable = !event.summaryOverrides && event.entries.every((entry) => entry.kind === "activity");
  const combine = () => {
    let id = "";
    undoable("Parts combined into one activity", (day) => { id = combineActivities(day, event.id).id; });
    focusLater(`activity-${id}`);
  };
  const change = (fn: (item: TrainingEvent) => void) => update((day) => {
    const item = day.events.find((candidate) => candidate.id === event.id);
    if (item) fn(item);
  });
  return <details className="card training-event">
    <summary id={`event-${event.id}`}>{event.title?.trim() || "Training event"} · {event.entries.length} {event.entries.length === 1 ? "part" : "parts"}</summary>
    <div className="event-parts">
      <MeasurementsHint measurements={measurements} overrides={event.summaryOverrides} />
      {combinable && <button type="button" className="btn secondary" onClick={combine}>Combine into one activity</button>}
      <label className="event-field">Event title
        <input className="text" type="text" value={event.title ?? ""} onChange={(changeEvent) => change((item) => (item.title = changeEvent.target.value || null))} />
      </label>
      <label className="event-field" htmlFor={`event-notes-${event.id}`}>Event notes</label>
      <AutoTextarea id={`event-notes-${event.id}`} minRows={2} value={event.notes} onChange={(changeEvent) => change((item) => (item.notes = changeEvent.target.value))} />
      {event.entries.map((entry) => <EventPart key={entry.kind === "session" ? `session-${entry.session.id}` : `activity-${entry.activity.id}`} eventId={event.id} entry={entry} sources={sources} sessionIndices={sessionIndices} totalSessions={totalSessions} action={actionFor(event, entry)} />)}
    </div>
  </details>;
}

/** Garmin source values, labelled apart from the saved, rounded minutes. */
function MeasurementsHint({ measurements: m, overrides }: { measurements: Omit<ReturnType<typeof eventMeasurements>, "sourceComplete">; overrides?: TrainingEvent["summaryOverrides"] }) {
  const minutes = (seconds: number) => formatNum(Math.round(seconds / 6) / 10);
  if (m.savedMinutes == null && m.timerSeconds == null && m.elapsedSeconds == null && m.activeCalories == null) return null;
  return <div className="hint">
    {m.savedMinutes != null && <div>Saved parts: {formatNum(m.savedMinutes)} min (rounded)</div>}
    {m.timerSeconds != null && <div>{overrides?.timerSeconds === undefined ? "Garmin timer" : "Event timer (entered)"}: {minutes(m.timerSeconds)} min</div>}
    {m.elapsedSeconds != null && <div>{overrides?.elapsedSeconds === undefined ? "Elapsed span" : "Event elapsed (entered)"}: {minutes(m.elapsedSeconds)} min</div>}
    {m.activeCalories != null && <div>{overrides?.activeCalories === undefined ? "Garmin source active calories" : "Event active calories (entered)"}: {formatNum(m.activeCalories)} cal</div>}
  </div>;
}

function ConflictBanner({ date, local, other }: { date: string; local: DayDoc; other: DayDoc | null }) {
  const [choice, setChoice] = useState<"mine" | "theirs" | null>(null);
  return (
    <>
      <div className="banner warn" role="alert">
        <Icon name="alert" />
        <div>
          <strong>This day was also changed on another device.</strong>
          <div className="muted">Pick which version to keep.</div>
          <div className="banner-actions">
            <button type="button" className="btn small secondary" onClick={() => setChoice("theirs")}>Use other device's</button>
            <button type="button" className="btn small primary" onClick={() => setChoice("mine")}>Keep this one</button>
          </div>
        </div>
      </div>
      {choice && (
        <Modal variant="sheet" label="Review day versions" onClose={() => setChoice(null)}>
          <div className="sheet conflict-review">
            <h2>Review day versions</h2>
            <p>{choice === "theirs" ? "Replacing this device's edits cannot be undone." : "Replacing the other device's edits cannot be undone."}</p>
            <div className="conflict-versions">
              <section>
                <h3>This device</h3>
                <pre className="share-text" role="region" aria-label="This device's full day" tabIndex={0}>{dayToText(local, exerciseName)}</pre>
              </section>
              <section>
                <h3>Other device</h3>
                <pre className="share-text" role="region" aria-label="Other device's full day" tabIndex={0}>{other ? dayToText(other, exerciseName) : "No day saved on the other device."}</pre>
              </section>
            </div>
            <button type="button" className="sheet-btn cancel" autoFocus onClick={() => setChoice(null)}>Cancel</button>
            <button type="button" className="sheet-btn danger" onClick={() => resolveConflict(date, choice)}>
              {choice === "theirs" ? "Replace this device's edits" : "Replace other device's edits"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function CommentCard({ comment }: { comment: DayComment }) {
  const { update, undoable } = useDayCtx();
  const { openSheet } = useOverlays();
  const change = (fn: (item: DayComment) => void) => update((day) => {
    const item = day.comments.find((entry) => entry.id === comment.id);
    if (item) fn(item);
  });
  return (
    <section className="card comment-card" data-comment-time={comment.time}>
      <label className="activity-time">Time
        <input type="time" aria-label="Comment time" value={comment.time} onChange={(event) => event.target.value && change((item) => (item.time = event.target.value))} />
      </label>
      <div className="activity-row">
        <label className="card-title" htmlFor={`comment-${comment.id}`}>Comment</label>
        <button type="button" className="icon-btn" aria-label="Comment options" onClick={() => openSheet({
          title: "Comment", actions: [{ label: "Delete", danger: true,
            onClick: () => undoable("Comment deleted", (day) => (day.comments = day.comments.filter((item) => item.id !== comment.id))) }],
        })}><Icon name="more" /></button>
      </div>
      <AutoTextarea id={`comment-${comment.id}`} minRows={2} value={comment.text} onChange={(event) => change((item) => (item.text = event.target.value))} />
    </section>
  );
}

function AddCommentCard() {
  const { update } = useDayCtx();
  const [open, setOpen] = useState(false);
  const [time, setTime] = useState(() => clockTime(nowLocal()));
  const [text, setText] = useState("");
  const add = () => {
    if (!text.trim()) return;
    update((day) => day.comments.push({ id: uid(), time, text }));
    setText("");
    setOpen(false);
  };
  return (
    <section className="card">
      {open ? <>
        <label className="activity-time">Time
          <input type="time" aria-label="New comment time" value={time} onChange={(event) => setTime(event.target.value)} />
        </label>
        <label className="card-title" htmlFor="new-day-comment">Comment</label>
        <AutoTextarea id="new-day-comment" minRows={2} placeholder="What happened?" autoFocus value={text} onChange={(event) => setText(event.target.value)} />
        <div className="row-actions">
          <button type="button" className="btn ghost" onClick={() => { setOpen(false); setText(""); }}>Cancel</button>
          <button type="button" className="btn primary" disabled={!text.trim() || !time} onClick={add}>Save comment</button>
        </div>
      </> : <button type="button" className="btn ghost" onClick={() => { setTime(clockTime(nowLocal())); setOpen(true); }}>
        <Icon name="plus" size={18} /> Add comment
      </button>}
    </section>
  );
}

function ActivityCard({ a, eventAction }: { a: Activity; eventAction?: EventAction }) {
  const { update, undoable } = useDayCtx();
  const { openPicker, openSheet } = useOverlays();
  const segment = a.segments[0];
  const name = exerciseName(segment.exerciseId);
  const up = (fn: (a: Activity) => void) =>
    update((d) => {
      const item = dayActivities(d).find((x) => x.id === a.id);
      if (item) fn(item);
    });
  const upSegment = (fn: (segment: Segment) => void) => up((item) => fn(item.segments[0]));

  return (
    <section className="card activity-card">
      <div className="card-title">Other activity</div>
      <div className="activity">
        <label className="activity-time">Start time
          <input type="time" aria-label={`Start time for ${name}`}
            value={clockTime(segment.startedAt)}
            onChange={(event) => event.target.value && upSegment((item) => { item.startedAt = withClock(item.startedAt, event.target.value); })} />
        </label>
        <div className="activity-row">
          <button type="button" className="text grow activity-name" aria-label={`Change ${name}`}
            onClick={() => openPicker({ section: "activity", title: "Change activity", initial: name, onPick: (id) => upSegment((x) => (x.exerciseId = id)) })}>
            {name}
          </button>
          <label className="unit-field">
            <NumberField value={segment.result.minutes} decimal={false} placeholder="–" ariaLabel="Minutes" onChange={(v) => upSegment((x) => (x.result.minutes = v))} />
            <span>min</span>
          </label>
          <label className="unit-field">
            <NumberField value={segment.result.calories} decimal={false} placeholder="–" ariaLabel="Active calories" onChange={(v) => upSegment((x) => (x.result.calories = v))} />
            <span>cal</span>
          </label>
          <button
            type="button"
            className="icon-btn"
            aria-label="Activity options"
            onClick={() =>
              openSheet({
                title: name,
                actions: [...(eventAction ? [eventAction] : []), {
                  label: "Delete",
                  danger: true,
                  onClick: () => undoable("Activity deleted", (d) => removeEventEntry(d, "activity", a.id)),
                }],
              })
            }
          >
            <Icon name="more" />
          </button>
        </div>
        <EffortPicker name={name} scale="RPE" value={a.effort} onChange={(value) => up((x) => { if (value) x.effort = value; else delete x.effort; })} />
      </div>
    </section>
  );
}

const resultText = (result: ActivityResult) =>
  [result.minutes != null && `${formatNum(result.minutes)} min`, result.calories != null && `${formatNum(result.calories)} cal`].filter(Boolean).join(" · ");

/** An activity of several segments: totals are read-only; split it to edit a segment. */
function CombinedActivityCard({ a, eventId, sources, eventAction }: { a: Activity; eventId: string; sources: ReadonlyMap<string, GarminActivitySummary>; eventAction?: EventAction }) {
  const { doc, update, undoable } = useDayCtx();
  const { openSheet } = useOverlays();
  const name = activityName(a, exerciseName);
  const up = (fn: (a: Activity) => void) => update((d) => {
    const item = dayActivities(d).find((x) => x.id === a.id);
    if (item) fn(item);
  });
  const menu = () => openSheet({ title: name, actions: [
    { label: "Split into separate activities", onClick: () => {
      undoable(`${name} split into ${a.segments.length} activities`, (d) => splitActivity(d, a.id, exerciseName));
      focusLater(`event-${eventId}`);
    } },
    ...(eventAction ? [eventAction] : []),
    { label: "Delete", danger: true, onClick: () => undoable("Activity deleted", (d) => removeEventEntry(d, "activity", a.id)) },
  ] });
  return (
    <section className="card activity-card" aria-labelledby={`activity-${a.id}`}>
      <div className="card-title">Other activity</div>
      <div className="combined-activity">
        <div className="activity-time">Start time <time dateTime={activityStart(a)}>{activityTime(a)}</time></div>
        <div className="activity-row">
          <h2 className="grow activity-name" id={`activity-${a.id}`} tabIndex={-1}>{name}</h2>
          <button type="button" className="icon-btn" aria-label={`${name} options`} onClick={menu}><Icon name="more" /></button>
        </div>
        <div className="activity-totals">{resultText(activityTotals(a)) || "No minutes or calories"}</div>
        <MeasurementsHint measurements={{ ...activityMeasurements(doc, a, sources), savedMinutes: null }} />
        <EffortPicker name={name} scale="RPE" value={a.effort} onChange={(value) => up((x) => { if (value) x.effort = value; else delete x.effort; })} />
        <label className="card-title" htmlFor={`activity-comment-${a.id}`}>Comment</label>
        <AutoTextarea id={`activity-comment-${a.id}`} aria-label={`${name} comment`} minRows={1} value={a.comment} onChange={(event) => up((x) => (x.comment = event.target.value))} />
        <details className="segments">
          <summary>{a.segments.length} segments</summary>
          <ol className="segment-list">
            {a.segments.map((segment) => <li key={segment.id}>{clockTime(segment.startedAt)} {exerciseName(segment.exerciseId)}{resultText(segment.result) && ` · ${resultText(segment.result)}`}</li>)}
          </ol>
        </details>
      </div>
    </section>
  );
}

function AddActivityCard() {
  const { date, doc, update } = useDayCtx();
  const { openPicker } = useOverlays();
  return (
    <section className="card">
      {dayActivities(doc).length === 0 && <div className="card-title">Other activity</div>}
      <div className="row-actions">
        <button
          type="button"
          className="btn ghost"
          onClick={() => openPicker({
            section: "activity",
            title: "Add activity",
            onPick: (exerciseId) => {
              const time = clockTime(nowLocal());
              const id = uid();
              const startedAt = atClock(date, time, deviceOffset(date, time));
              update((d) => addEventEntry(d, { kind: "activity", activity: { id, comment: "", segments: [{ id, exerciseId, startedAt, result: { minutes: null, calories: null } }] } }));
            },
          })}
        >
          <Icon name="plus" size={18} />
          Add activity
        </button>
      </div>
    </section>
  );
}

function TotalsCard() {
  const { doc, update } = useDayCtx();
  const logged = daySessions(doc).reduce((n, s) => n + (s.calories ?? 0), 0) + dayActivities(doc).reduce((n, a) => n + (activityTotals(a).calories ?? 0), 0);
  const mixed = doc.events.some((event) => event.entries.some((entry) => entry.kind === "session") && event.entries.some((entry) => entry.kind === "activity"));
  return (
    <section className="card">
      <label className="inline-field">
        <span>Total daily active calories</span>
        <NumberField
          value={doc.totalCalories}
          decimal={false}
          placeholder="–"
          ariaLabel="Total daily active calories"
          onChange={(v) => update((d) => (d.totalCalories = v))}
        />
      </label>
      {mixed ? <div className="hint">Session and activity calories may overlap. Enter the daily total separately.</div> : logged > 0 && <div className="hint">Logged above: {logged} cal</div>}
    </section>
  );
}
