import { useEffect, useState, type ChangeEvent } from "react";
import type { GarminActivitySummary } from "../../../shared/garmin/fit";
import { emptyDay } from "../../../shared/days/model";
import { acceptActivity, ignoreGarmin, linkStrengthSession, strengthMatches, unlinkGarmin } from "../../../shared/garmin/decisions";
import { request, trpc } from "../../api";
import { addDays, goToDate, todayLocal } from "../days/dates";
import { useDay } from "../days/hooks";
import { getEntry, loadFromServer, onSynced, setDoc } from "../days/store";
import { createLocalExercise } from "../exercises/catalog";

type Listed = GarminActivitySummary & { importedAt: string; status: string; targetId: string | null; decisionDate: string | null };
const sourceDate = (source: GarminActivitySummary) => source.localDate ?? source.startUtc.slice(0, 10);
const isStrength = (source: GarminActivitySummary) => source.subSport === "strengthTraining";

function sourceTime(source: GarminActivitySummary): string {
  const offset = source.offsetMinutes;
  if (offset == null) return `${source.startUtc.slice(0, 16).replace("T", " ")} UTC`;
  const local = new Date(Date.parse(source.startUtc) + offset * 60_000).toISOString();
  return `${local.slice(0, 16).replace("T", " ")} UTC${offset < 0 ? "−" : "+"}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0")}:${String(Math.abs(offset) % 60).padStart(2, "0")}`;
}

export function GarminView() {
  const [from, setFrom] = useState(() => addDays(todayLocal(), -365));
  const [to, setTo] = useState(todayLocal);
  const [records, setRecords] = useState<Listed[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async (first = from, last = to) => {
    try {
      setRecords(await request(trpc.garmin.list.query({ from: first, to: last })));
      setMessage("");
    } catch { setMessage("Unable to load Garmin activities. Check your connection and retry."); }
  };
  useEffect(() => { void load(); }, [from, to]);
  useEffect(() => onSynced(() => { void load(); }), [from, to]);

  const importFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    if (!files.length) return;
    setLoading(true);
    try {
      const { parseGarminFit } = await import("../../../shared/garmin/fit");
      const summaries: GarminActivitySummary[] = [];
      const errors: string[] = [];
      for (const file of files) {
        try {
          const parsed = parseGarminFit(new Uint8Array(await file.arrayBuffer()));
          summaries.push(...parsed.activities);
          errors.push(...parsed.rejected.map((error) => `${file.name}: ${error}`));
        } catch (error) { errors.push(`${file.name}: ${error instanceof Error ? error.message : "Unable to read FIT file"}`); }
      }
      let inserted = 0, unchanged = 0, updated = 0, rejected = errors.length;
      for (let i = 0; i < summaries.length; i += 100) {
        const result = await request(trpc.garmin.import.mutate({ activities: summaries.slice(i, i + 100) }));
        inserted += result.inserted; unchanged += result.unchanged; updated += result.updated; rejected += result.rejected;
      }
      if (summaries.length) {
        const dates = summaries.map(sourceDate).sort();
        const first = dates[0] < from ? dates[0] : from;
        const last = dates.at(-1)! > to ? dates.at(-1)! : to;
        setFrom(first); setTo(last);
        await load(first, last);
      }
      setMessage(`${inserted} imported, ${unchanged} unchanged, ${updated} updated, ${rejected} rejected.${errors.length ? ` ${errors.join(" ")}` : ""}`);
    } catch { setMessage("Unable to import FIT files. Check your connection and retry."); }
    finally { setLoading(false); event.target.value = ""; }
  };

  const acceptAll = async () => {
    setLoading(true);
    let accepted = 0;
    try {
      for (const source of records.filter((item) => item.status === "pending" && !isStrength(item))) {
        const date = sourceDate(source);
        await loadFromServer(date);
        const doc = structuredClone(getEntry(date)?.doc ?? emptyDay(date));
        if (doc.activities.some((item) => item.garminSourceKey === source.sourceKey) || doc.ignoredGarminSourceKeys.includes(source.sourceKey)) continue;
        acceptActivity(doc, source, createLocalExercise(source.title).id);
        setDoc(date, doc);
        accepted++;
      }
      setMessage(`${accepted} activities added to local days. They will sync with your other device.`);
    } catch { setMessage("Unable to add every activity. Review the saved days and retry."); }
    finally { setLoading(false); }
  };

  return <>
    <section className="card">
      <h2 className="card-title">Import original FIT files</h2>
      <label className="garmin-file">Choose FIT files<input type="file" accept=".fit" multiple onChange={(event) => void importFiles(event)} disabled={loading} /></label>
      <p className="hint">Export File in Garmin Connect gives a ZIP. Unzip it, then choose the .fit files. Active calories use the FIT session's total and metabolic calories.</p>
      <div className="garmin-filters">
        <label>From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label>To<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        <button type="button" className="btn small secondary" onClick={() => void load()} disabled={loading}>Refresh</button>
      </div>
      <div role="status" aria-live="polite">{message}</div>
    </section>
    {records.some((item) => item.status === "pending" && !isStrength(item)) && <button type="button" className="btn big secondary garmin-bulk" onClick={() => void acceptAll()} disabled={loading}>Add pending non-strength activities</button>}
    {records.length === 0 && <section className="card"><p>No Garmin recordings in this date range. Choose original FIT files or change the dates.</p></section>}
    {records.map((source) => <GarminRecord key={source.sourceKey} source={source} />)}
  </>;
}

function GarminRecord({ source }: { source: Listed }) {
  const [date, setDate] = useState(source.decisionDate ?? sourceDate(source));
  const [name, setName] = useState(source.title);
  const [choice, setChoice] = useState("");
  const [error, setError] = useState("");
  const { doc, entry, update } = useDay(date);
  const localActivity = doc.activities.find((item) => item.garminSourceKey === source.sourceKey);
  const localSession = doc.sessions.find((item) => item.garminSourceKey === source.sourceKey);
  const localStatus = localActivity ? "activity" : localSession ? "session" : doc.ignoredGarminSourceKeys.includes(source.sourceKey) ? "ignored" : null;
  const status = entry?.dirty ? localStatus ?? "pending" : localStatus ?? source.status;
  const matches = strengthMatches(doc, source);
  const selected = choice || (matches.length === 1 ? matches[0] : "");
  const completed = doc.sessions.filter((session) => session.endedAt && !session.garminSourceKey);

  const decide = async (action: (day: typeof doc) => void) => {
    try {
      await loadFromServer(date);
      update(action);
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save. Retry this action."); }
  };
  const recordedMinutes = source.timerSeconds == null ? "unknown duration" : `${Math.round(source.timerSeconds / 60)} min timer`;
  const saved = localActivity ? `${localActivity.result.minutes ?? "–"} min · ${localActivity.result.calories ?? "–"} active cal` : localSession ? `${localSession.calories ?? "–"} active cal` : null;
  return <section className="card garmin-record" aria-label={`${source.title} Garmin recording`}>
    <div className="garmin-record-head"><h2>{source.title}</h2><span>{status === "pending" ? "Pending" : status === "ignored" ? "Ignored" : status === "session" ? "Linked session" : "Added activity"}</span></div>
    <div className="hint">Garmin: {sourceTime(source)} · {recordedMinutes} · {source.activeCalories} active cal</div>
    {saved && <div className="hint">Trainoq: {saved}</div>}
    {error && <div className="banner warn" role="alert">{error} Retry or refresh this page.</div>}
    {status === "pending" ? <>
      <div className="garmin-fields">
        <label>Trainoq date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <label>Activity name<input type="text" value={name} maxLength={200} onChange={(event) => setName(event.target.value)} /></label>
      </div>
      {isStrength(source) && completed.length > 0 && <label className="garmin-select">Training session
        <select value={selected} onChange={(event) => setChoice(event.target.value)}>
          <option value="">Choose a session</option>
          {completed.map((session) => <option key={session.id} value={session.id}>{new Date(session.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}{matches.includes(session.id) ? " · close match" : ""}</option>)}
        </select>
      </label>}
      <div className="garmin-actions">
        {isStrength(source) && selected && <button type="button" className="btn small secondary" onClick={() => void decide((day) => linkStrengthSession(day, source, selected))}>Link to session</button>}
        <button type="button" className="btn small secondary" onClick={() => void decide((day) => acceptActivity(day, source, createLocalExercise(name.trim() || source.title).id))}>Create activity</button>
        <button type="button" className="btn small ghost" aria-label={`Ignore ${source.title}`} onClick={() => void decide((day) => ignoreGarmin(day, source.sourceKey))}>Ignore</button>
      </div>
    </> : <div className="garmin-actions">
      {status !== "ignored" && <button type="button" className="btn small secondary" onClick={() => goToDate(date)}>Edit saved day</button>}
      <button type="button" className="btn small ghost" aria-label={`${status === "ignored" ? "Restore" : "Unlink"} ${source.title}`} onClick={() => void decide((day) => unlinkGarmin(day, source.sourceKey))}>{status === "ignored" ? "Restore" : "Unlink"}</button>
    </div>}
  </section>;
}
