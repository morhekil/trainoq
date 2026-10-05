import { useEffect, useRef, useState, type FormEvent } from "react";
import type { GarminActivitySummary } from "../../../shared/garmin/fit";
import { emptyDay } from "../../../shared/days/model";
import { acceptActivity, ignoreGarmin, linkStrengthSession, moveLinkedActivity, strengthMatches, unlinkGarmin } from "../../../shared/garmin/decisions";
import { request, trpc } from "../../api";
import { addDays, goToDate, todayLocal } from "../days/dates";
import { useDay } from "../days/hooks";
import { getEntry, loadFromServer, registerGarminMove, setDoc, sync } from "../days/store";
import { createLocalExercise } from "../exercises/catalog";

type Listed = GarminActivitySummary & { importedAt: string; status: string; targetId: string | null; decisionDate: string | null };
type Cursor = { importedAt: string; sourceKey: string };
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
  const [showAll, setShowAll] = useState(false);
  const [nextCursor, setNextCursor] = useState<Cursor | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const requestVersion = useRef(0);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async (first = from, last = to, includeLinked = showAll, cursor?: Cursor) => {
    const version = cursor ? requestVersion.current : ++requestVersion.current;
    setListLoading(true);
    try {
      const page = await request(trpc.garmin.list.query({ from: first, to: last, includeLinked, cursor }));
      if (version !== requestVersion.current) return;
      setRecords((current) => cursor ? [...current, ...page.items] : page.items);
      setNextCursor(page.nextCursor);
      setMessage("");
    } catch { if (version === requestVersion.current) setMessage("Unable to load Garmin activities. Check your connection and retry."); }
    finally { if (version === requestVersion.current) setListLoading(false); }
  };
  useEffect(() => { void load(); }, [from, to, showAll]);

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
    <GarminConnection onImported={() => load()} />
    <section className="card">
      <h2 className="card-title">Review recordings</h2>
      <div className="garmin-filters">
        <label>From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label>To<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        <button type="button" className="btn small secondary" onClick={() => void load()} disabled={loading || listLoading}>Refresh</button>
        <button type="button" className="btn small secondary" onClick={() => setShowAll((current) => !current)} disabled={listLoading}>{showAll ? "Show pending only" : "Show all"}</button>
      </div>
      <div role="status" aria-live="polite">{message}</div>
    </section>
    {records.some((item) => item.status === "pending" && !isStrength(item)) && <button type="button" className="btn big secondary garmin-bulk" onClick={() => void acceptAll()} disabled={loading}>Add loaded pending non-strength activities</button>}
    {!listLoading && records.length === 0 && <section className="card"><p>{showAll ? "No Garmin recordings in this date range. Sync Garmin or change the dates." : "No pending Garmin recordings in this date range. Show all to review linked or ignored recordings, or change the dates."}</p></section>}
    {records.map((source) => <GarminRecord key={source.sourceKey} source={source} />)}
    {nextCursor && <button type="button" className="btn big secondary garmin-bulk" onClick={() => void load(from, to, showAll, nextCursor)} disabled={listLoading}>{listLoading ? "Loading..." : "Load more"}</button>}
  </>;
}

type Connection = { status: string; email: string | null; lastSyncAt: string | null; lastError: string | null; nextOffset: number };

function GarminConnection({ onImported }: { onImported: () => Promise<void> }) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [working, setWorking] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  const reload = async () => setConnection(await request(trpc.garmin.connection.query()));
  useEffect(() => { void reload().catch(() => setError("Unable to load Garmin connection. Retry by reopening this page.")); }, []);

  const syncAll = async () => {
    setSyncing(true); setError("");
    let scanned = 0, imported = 0;
    try {
      for (;;) {
        const result = await request(trpc.garmin.sync.mutate());
        scanned += result.scanned;
        imported += result.inserted;
        setProgress(`${scanned} recordings checked, ${imported} imported`);
        if (result.complete) break;
      }
      await onImported();
      await reload();
      setProgress(`Backfill complete: ${scanned} recordings checked, ${imported} imported.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to sync Garmin. Retry later.");
      await reload().catch(() => {});
    }
    finally { setSyncing(false); }
  };

  const connect = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const email = String(data.get("email") ?? "");
    const password = String(data.get("password") ?? "");
    form.reset();
    setWorking(true); setError("");
    try {
      const result = await request(trpc.garmin.connect.mutate({ email, password }));
      await reload();
      if (result.status === "connected") void syncAll();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to connect Garmin. Retry."); }
    finally { setWorking(false); }
  };

  const verify = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const code = String(new FormData(form).get("code") ?? "");
    form.reset();
    setWorking(true); setError("");
    try {
      await request(trpc.garmin.verifyMfa.mutate({ code }));
      await reload();
      void syncAll();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to verify Garmin sign-in. Retry."); }
    finally { setWorking(false); }
  };

  const disconnect = async () => {
    if (!window.confirm("Disconnect Garmin and remove its stored credentials? Imported recordings will stay in Trainoq.")) return;
    setWorking(true); setError("");
    try { await request(trpc.garmin.disconnect.mutate()); await reload(); setProgress(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to disconnect Garmin. Retry."); }
    finally { setWorking(false); }
  };

  return <section className="card" aria-label="Garmin connection">
    <h2 className="card-title">Garmin connection</h2>
    {(connection?.status === "disconnected" || connection?.status === "error") && <>
      <p className="hint">{connection.status === "error" ? "Enter your Garmin credentials again to resume syncing." : "Connect once to import recordings automatically. Trainoq stores your Garmin password encrypted so it can reconnect."}</p>
      <form className="garmin-connect-form" onSubmit={(event) => void connect(event)}>
        <label>Garmin email<input className="text" type="email" name="email" autoComplete="username" defaultValue={connection.email ?? ""} required /></label>
        <label>Garmin password<input className="text" type="password" name="password" autoComplete="current-password" required /></label>
        <button type="submit" className="btn primary" disabled={working}>Connect Garmin</button>
      </form>
    </>}
    {connection?.status === "mfa" && <form className="garmin-connect-form" onSubmit={(event) => void verify(event)}>
      <p>Garmin requested a verification code for {connection.email}.</p>
      <label>Verification code<input className="text" type="text" name="code" autoComplete="one-time-code" inputMode="numeric" required /></label>
      <button type="submit" className="btn primary" disabled={working}>Verify Garmin sign-in</button>
    </form>}
    {connection?.status === "connected" && <>
      <p>Connected as {connection.email}. New recordings sync every five minutes.</p>
      {connection.lastSyncAt && <p className="hint">Last synced {new Date(connection.lastSyncAt).toLocaleString()}</p>}
      <div className="garmin-actions">
        <button type="button" className="btn secondary" onClick={() => void syncAll()} disabled={syncing || working}>{syncing ? "Syncing Garmin..." : "Sync all now"}</button>
        <button type="button" className="btn ghost" onClick={() => void disconnect()} disabled={syncing || working}>Disconnect Garmin</button>
      </div>
    </>}
    <div role="status" aria-live="polite">{progress}</div>
    {connection?.lastError && !error && <p role="alert">{connection.lastError}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

function GarminRecord({ source }: { source: Listed }) {
  const [date, setDate] = useState(source.decisionDate ?? sourceDate(source));
  const [moveDate, setMoveDate] = useState(source.decisionDate ?? sourceDate(source));
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
  const moveActivity = async () => {
    try {
      if (moveDate === date) return;
      await Promise.all([loadFromServer(date), loadFromServer(moveDate)]);
      const from = structuredClone(getEntry(date)?.doc ?? emptyDay(date));
      const to = structuredClone(getEntry(moveDate)?.doc ?? emptyDay(moveDate));
      moveLinkedActivity(from, to, source.sourceKey);
      registerGarminMove(date, moveDate, source.sourceKey);
      setDoc(moveDate, to, false);
      setDoc(date, from, false);
      const oldDate = date;
      await sync(oldDate);
      if (getEntry(oldDate)?.dirty || getEntry(oldDate)?.conflict) throw new Error("Date change is saved locally. Sync the old day before retrying.");
      await sync(moveDate);
      if (getEntry(moveDate)?.dirty || getEntry(moveDate)?.conflict) throw new Error("Date change is saved locally. Retry sync when connected.");
      setDate(moveDate);
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to move activity. Retry after syncing."); }
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
    </> : <>
      {status === "activity" && <div className="garmin-fields">
        <label>Correct Trainoq date<input type="date" value={moveDate} onChange={(event) => setMoveDate(event.target.value)} /></label>
        <button type="button" className="btn small secondary" disabled={moveDate === date} onClick={() => void moveActivity()}>Move activity</button>
      </div>}
      <div className="garmin-actions">
        {status !== "ignored" && <button type="button" className="btn small secondary" onClick={() => goToDate(date)}>Edit saved day</button>}
        <button type="button" className="btn small ghost" aria-label={`${status === "ignored" ? "Restore" : "Unlink"} ${source.title}`} onClick={() => void decide((day) => unlinkGarmin(day, source.sourceKey))}>{status === "ignored" ? "Restore" : "Unlink"}</button>
      </div>
    </>}
  </section>;
}
