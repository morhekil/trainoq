import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { addEventEntry, dayActivities, daySessions, detachEventEntry, emptyDay, mergeEvents, removeEventEntry, type Activity, type DayComment, type DayDoc, type EventEntry, type TrainingEvent } from "../../../shared/days/model";
import { dayToText } from "../../../shared/days/format";
import { activityTime, orderedDayEvents, orderedDayRecords } from "../../../shared/days/timeline";
import { useDay } from "./hooks";
import { libraryVersion, refreshLibrary, subscribeLibrary } from "../exercises/library";
import { exerciseName } from "../exercises/catalog";
import { newSession } from "../sessions/ops";
import { loadRecentSessions } from "../sessions/recent";
import { getEntry, resolveConflict } from "./store";
import { todayLocal } from "./dates";
import { hhmmToIso, isoToHHMM } from "../sessions/time";
import { uid } from "../../id";
import { DayContext, useDayCtx, type DayCtx } from "./context";
import { Icon } from "../../icons";
import { AutoTextarea, NumberField } from "../../inputs";
import { useOverlays } from "../../overlays";
import { Modal } from "../../modal";
import { SessionCard } from "../sessions/session";
import { suggestedRecordingGroups } from "../../../shared/garmin/decisions";
import { eventMeasurements } from "../../../shared/days/summary";
import type { GarminActivitySummary } from "../../../shared/garmin/fit";
import { formatNum } from "../../../shared/exercises/format";
import { request, trpc } from "../../api";

export function DayView({ date }: { date: string }) {
  useSyncExternalStore(subscribeLibrary, libraryVersion);
  const { doc, entry, update, replace } = useDay(date);
  const { openSheet, toast } = useOverlays();
  const [recentVersion, setRecentVersion] = useState(0);
  const [sources, setSources] = useState<Map<string, GarminActivitySummary>>(new Map());
  const sourceKeys = doc.events.flatMap((event) => event.entries.map((part) => part.kind === "session" ? part.session.garminSourceKey : part.activity.garminSourceKey).filter((key): key is string => !!key)).sort().join("|");

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
    (message: string, fn: (d: DayDoc) => void) => {
      const prev = getEntry(date)?.doc ?? emptyDay(date);
      update(fn);
      toast(message, () => replace(prev));
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
        s.startedAt = hhmmToIso(date, isoToHHMM(s.startedAt));
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
          : <EventPart key={record.event.id} entry={record.event.entries[0]} sessionIndices={sessionIndices} totalSessions={daySessions(doc).length} action={actionFor(record.event, record.event.entries[0])} />)}
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
  if (first.kind === "session") return `Session at ${new Date(first.session.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  return `${exerciseName(first.activity.exerciseId)} at ${activityTime(first.activity) ?? "unknown time"}`;
}

function EventPart({ entry, sessionIndices, totalSessions, action }: { entry: EventEntry; sessionIndices: Map<string, number>; totalSessions: number; action?: EventAction }) {
  return entry.kind === "session"
    ? <SessionCard s={entry.session} index={sessionIndices.get(entry.session.id) ?? 0} total={totalSessions} eventAction={action} />
    : <ActivityCard a={entry.activity} eventAction={action} />;
}

function TrainingEventCard({ event, sources, sessionIndices, totalSessions, actionFor }: { event: TrainingEvent; sources: ReadonlyMap<string, GarminActivitySummary>; sessionIndices: Map<string, number>; totalSessions: number; actionFor: (event: TrainingEvent, entry: EventEntry) => EventAction | undefined }) {
  const { update } = useDayCtx();
  const measurements = eventMeasurements(event, sources);
  const minutes = (seconds: number) => formatNum(Math.round(seconds / 6) / 10);
  const change = (fn: (item: TrainingEvent) => void) => update((day) => {
    const item = day.events.find((candidate) => candidate.id === event.id);
    if (item) fn(item);
  });
  return <details className="card training-event">
    <summary>{event.title?.trim() || "Training event"} · {event.entries.length} {event.entries.length === 1 ? "part" : "parts"}</summary>
    <div className="event-parts">
      {(measurements.savedMinutes != null || measurements.timerSeconds != null || measurements.elapsedSeconds != null || measurements.activeCalories != null) && <div className="hint">
        {measurements.savedMinutes != null && <div>Saved parts: {formatNum(measurements.savedMinutes)} min (rounded)</div>}
        {measurements.timerSeconds != null && <div>{event.summaryOverrides?.timerSeconds === undefined ? "Garmin timer" : "Event timer (entered)"}: {minutes(measurements.timerSeconds)} min</div>}
        {measurements.elapsedSeconds != null && <div>{event.summaryOverrides?.elapsedSeconds === undefined ? "Elapsed span" : "Event elapsed (entered)"}: {minutes(measurements.elapsedSeconds)} min</div>}
        {measurements.activeCalories != null && <div>{event.summaryOverrides?.activeCalories === undefined ? "Garmin source active calories" : "Event active calories (entered)"}: {formatNum(measurements.activeCalories)} cal</div>}
      </div>}
      <label className="event-field">Event title
        <input className="text" type="text" value={event.title ?? ""} onChange={(changeEvent) => change((item) => (item.title = changeEvent.target.value || null))} />
      </label>
      <label className="event-field" htmlFor={`event-notes-${event.id}`}>Event notes</label>
      <AutoTextarea id={`event-notes-${event.id}`} minRows={2} value={event.notes} onChange={(changeEvent) => change((item) => (item.notes = changeEvent.target.value))} />
      {event.entries.map((entry) => <EventPart key={entry.kind === "session" ? `session-${entry.session.id}` : `activity-${entry.activity.id}`} entry={entry} sessionIndices={sessionIndices} totalSessions={totalSessions} action={actionFor(event, entry)} />)}
    </div>
  </details>;
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
                <pre className="share-text" role="region" aria-label="This device's full day" tabIndex={0}>{dayToText(local, undefined, exerciseName)}</pre>
              </section>
              <section>
                <h3>Other device</h3>
                <pre className="share-text" role="region" aria-label="Other device's full day" tabIndex={0}>{other ? dayToText(other, undefined, exerciseName) : "No day saved on the other device."}</pre>
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
  const [time, setTime] = useState(() => isoToHHMM(new Date().toISOString()));
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
      </> : <button type="button" className="btn ghost" onClick={() => { setTime(isoToHHMM(new Date().toISOString())); setOpen(true); }}>
        <Icon name="plus" size={18} /> Add comment
      </button>}
    </section>
  );
}

function ActivityCard({ a, eventAction }: { a: Activity; eventAction?: EventAction }) {
  const { date, update, undoable } = useDayCtx();
  const { openPicker, openSheet } = useOverlays();
  const up = (id: string, fn: (a: Activity) => void) =>
    update((d) => {
      const a = dayActivities(d).find((x) => x.id === id);
      if (a) fn(a);
    });

  return (
    <section className="card activity-card">
      <div className="card-title">Other activity</div>
      <div className="activity">
        <label className="activity-time">Start time
          <input type="time" aria-label={`Start time for ${exerciseName(a.exerciseId)}`}
            value={activityTime(a) ?? ""}
            onChange={(event) => event.target.value && up(a.id, (item) => { item.startedAt = item.sourceOffsetMinutes == null
              ? hhmmToIso(date, event.target.value)
              : new Date(Date.parse(`${date}T${event.target.value}:00.000Z`) - item.sourceOffsetMinutes * 60_000).toISOString(); })} />
        </label>
        <div className="activity-row">
          <button type="button" className="text grow activity-name" aria-label={`Change ${exerciseName(a.exerciseId)}`}
            onClick={() => openPicker({ section: "activity", title: "Change activity", initial: exerciseName(a.exerciseId), onPick: (id) => up(a.id, (x) => (x.exerciseId = id)) })}>
            {exerciseName(a.exerciseId)}
          </button>
          <label className="unit-field">
            <NumberField value={a.result.minutes} decimal={false} placeholder="–" ariaLabel="Minutes" onChange={(v) => up(a.id, (x) => (x.result.minutes = v))} />
            <span>min</span>
          </label>
          <label className="unit-field">
            <NumberField value={a.result.calories} decimal={false} placeholder="–" ariaLabel="Active calories" onChange={(v) => up(a.id, (x) => (x.result.calories = v))} />
            <span>cal</span>
          </label>
          <button
            type="button"
            className="icon-btn"
            aria-label="Activity options"
            onClick={() =>
              openSheet({
                title: exerciseName(a.exerciseId),
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
              const startedAt = hhmmToIso(date, isoToHHMM(new Date().toISOString()));
              update((d) => addEventEntry(d, { kind: "activity", activity: { id: uid(), exerciseId, startedAt, comment: "", result: { minutes: null, calories: null } } }));
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
  const logged = daySessions(doc).reduce((n, s) => n + (s.calories ?? 0), 0) + dayActivities(doc).reduce((n, a) => n + (a.result.calories ?? 0), 0);
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
