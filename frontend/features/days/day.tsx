import { useCallback, useEffect, useMemo, useState } from "react";
import { emptyDay, type Activity, type DayDoc } from "../../../shared/days/model";
import { dayToText } from "../../../shared/days/format";
import { useDay } from "./hooks";
import { refreshLibrary } from "../exercises/library";
import { exerciseName } from "../exercises/catalog";
import { newSession, move } from "../sessions/ops";
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

const ACTIVITY_SUGGESTIONS = ["Walk", "Run", "Ride", "Bouldering", "Swim", "Hike", "Yoga", "Mobility"];

export function DayView({ date }: { date: string }) {
  const { doc, entry, update, replace } = useDay(date);
  const { toast } = useOverlays();
  const [recentVersion, setRecentVersion] = useState(0);

  useEffect(() => {
    void refreshLibrary();
    void loadRecentSessions(date).then((changed) => changed && setRecentVersion((v) => v + 1));
  }, [date]);

  const undoable = useCallback(
    (message: string, fn: (d: DayDoc) => void) => {
      const prev = getEntry(date)?.doc ?? emptyDay(date);
      update(fn);
      toast(message, () => replace(prev));
    },
    [date, update, replace, toast],
  );

  const ctx = useMemo<DayCtx>(() => ({ date, doc, update, undoable, recentVersion }), [date, doc, update, undoable, recentVersion]);
  const active = doc.sessions.some((s) => !s.endedAt);

  const start = () =>
    update((d) => {
      const s = newSession();
      if (date !== todayLocal()) {
        // logging a past day: use this time of day on that date, and don't leave it running
        s.startedAt = hhmmToIso(date, isoToHHMM(s.startedAt));
        s.endedAt = s.startedAt;
      }
      d.sessions.push(s);
    });

  return (
    <DayContext.Provider value={ctx}>
      {entry?.conflict && <ConflictBanner date={date} local={doc} other={entry.conflict.doc} />}
      <MorningCard />
      {doc.sessions.map((s, i) => (
        <SessionCard key={s.id} s={s} index={i} total={doc.sessions.length} />
      ))}
      {!active && (
        <button type="button" className="btn big primary start-btn" onClick={start}>
          <Icon name="play" size={18} />
          {doc.sessions.length ? "Start another session" : "Start training session"}
        </button>
      )}
      <ActivitiesCard />
      <TotalsCard />
    </DayContext.Provider>
  );
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

function MorningCard() {
  const { doc, update } = useDayCtx();
  return (
    <section className="card">
      <label className="card-title" htmlFor="morning">
        Morning check-in
      </label>
      <AutoTextarea
        id="morning"
        minRows={2}
        placeholder="Stiffness, sleep, pain, energy, meds…"
        value={doc.morning}
        onChange={(e) => update((d) => (d.morning = e.target.value))}
      />
    </section>
  );
}

function ActivitiesCard() {
  const { doc, update, undoable } = useDayCtx();
  const { openSheet } = useOverlays();
  const up = (id: string, fn: (a: Activity) => void) =>
    update((d) => {
      const a = d.activities.find((x) => x.id === id);
      if (a) fn(a);
    });

  return (
    <section className="card">
      <div className="card-title">Other activity</div>
      {doc.activities.map((a, i) => (
        <div key={a.id} className="activity">
          <div className="activity-row">
            <input
              className="text grow"
              type="text"
              list="activity-suggestions"
              placeholder="Walk, ride…"
              aria-label="Activity"
              value={a.name}
              onChange={(e) => up(a.id, (x) => (x.name = e.target.value))}
            />
            <label className="unit-field">
              <NumberField value={a.minutes} decimal={false} placeholder="–" ariaLabel="Minutes" onChange={(v) => up(a.id, (x) => (x.minutes = v))} />
              <span>min</span>
            </label>
            <label className="unit-field">
              <NumberField value={a.calories} decimal={false} placeholder="–" ariaLabel="Active calories" onChange={(v) => up(a.id, (x) => (x.calories = v))} />
              <span>cal</span>
            </label>
            <button
              type="button"
              className="icon-btn"
              aria-label="Activity options"
              onClick={() =>
                openSheet({
                  title: a.name || "Activity",
                  actions: [
                    ...(i > 0 ? [{ label: "Move up", icon: "chevronUp" as const, onClick: () => update((d) => move(d.activities, i, -1)) }] : []),
                    {
                      label: "Delete",
                      danger: true,
                      onClick: () => undoable("Activity deleted", (d) => (d.activities = d.activities.filter((x) => x.id !== a.id))),
                    },
                  ],
                })
              }
            >
              <Icon name="more" />
            </button>
          </div>
        </div>
      ))}
      <div className="row-actions">
        <button
          type="button"
          className="btn ghost"
          onClick={() => update((d) => d.activities.push({ id: uid(), name: "", minutes: null, calories: null, notes: "" }))}
        >
          <Icon name="plus" size={18} />
          Add activity
        </button>
      </div>
      <datalist id="activity-suggestions">
        {ACTIVITY_SUGGESTIONS.map((a) => (
          <option key={a} value={a} />
        ))}
      </datalist>
    </section>
  );
}

function TotalsCard() {
  const { doc, update } = useDayCtx();
  const logged = doc.sessions.reduce((n, s) => n + (s.calories ?? 0), 0) + doc.activities.reduce((n, a) => n + (a.calories ?? 0), 0);
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
      {logged > 0 && <div className="hint">Logged above: {logged} cal</div>}
      <label className="card-title" htmlFor="day-notes">Day notes</label>
      <AutoTextarea id="day-notes" minRows={1} value={doc.notes} onChange={(e) => update((d) => (d.notes = e.target.value))} />
    </section>
  );
}
