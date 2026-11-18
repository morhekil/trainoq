import { useEffect, useRef, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../backend/router";
import type { WeightMeasurement } from "../../../shared/withings/model";
import { request, trpc } from "../../api";
import { WeightReadings } from "./readings";

type Connection = inferRouterOutputs<AppRouter>["withings"]["connection"];
type Cursor = { measuredAt: string; sourceId: string };

export function WithingsView() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [items, setItems] = useState<WeightMeasurement[]>([]);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [authorizationFailed, setAuthorizationFailed] = useState(() => location.hash.includes("?error=authorization"));
  const version = useRef(0);

  const load = async (next?: Cursor) => {
    const current = ++version.current;
    setLoading(true); setError("");
    try {
      const [status, page] = await Promise.all([request(trpc.withings.connection.query()), request(trpc.withings.measurements.query({ cursor: next }))]);
      if (current !== version.current) return;
      setConnection(status); setItems((previous) => next ? [...previous, ...page.items] : page.items); setCursor(page.nextCursor);
    } catch { if (current === version.current) setError("Unable to load Withings data. Check your connection and choose Retry loading."); }
    finally { if (current === version.current) setLoading(false); }
  };
  useEffect(() => { void load(); return () => { version.current++; }; }, []);

  const connect = async () => {
    setWorking(true); setError(""); setAuthorizationFailed(false);
    try { location.assign((await request(trpc.withings.authorize.mutate())).url); }
    catch { setError("Unable to start Withings authorization. Check your connection and choose Connect Withings again."); setWorking(false); }
  };
  const sync = async () => {
    setWorking(true); setError(""); setMessage("");
    try {
      const result = await request(trpc.withings.sync.mutate());
      setMessage(`Imported ${result.imported} ${result.imported === 1 ? "reading" : "readings"}. ${result.complete ? "Weight is up to date." : "More history will sync automatically. Choose Sync now to continue immediately."}`);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to sync Withings. Choose Sync now to retry."); }
    finally { setWorking(false); }
  };
  const disconnect = async () => {
    if (!window.confirm("Disconnect Withings and remove its stored tokens? Imported weight measurements will stay in Trainoq.")) return;
    setWorking(true); setError("");
    try { await request(trpc.withings.disconnect.mutate()); await load(); setMessage("Withings disconnected. Imported measurements are kept."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to disconnect Withings. Retry shortly."); }
    finally { setWorking(false); }
  };

  return <>
    <section className="card" aria-label="Withings connection">
      <h2 className="card-title">Withings connection</h2>
      {connection && (!connection.configured ? <p>Withings is not available yet. Ask the app owner to finish setup.</p> : <>
        <p>{connection.connected ? "Connected to Withings. Weight syncs every five minutes." : "Connect Withings to import your weight history and sync new measurements automatically."}</p>
        {connection.connected && !connection.historyComplete && <p className="hint">Importing weight history. Each sync continues where the last one stopped.</p>}
        {connection.lastSyncAt && <p className="hint">Last synced {new Date(connection.lastSyncAt).toLocaleString()}</p>}
        <div className="withings-actions">
          {connection.connected && <button type="button" className="btn primary" disabled={working || loading} onClick={() => void sync()}>{working ? "Working..." : "Sync now"}</button>}
          <button type="button" className={`btn ${connection.connected ? "secondary" : "primary"}`} disabled={working || loading} onClick={() => void connect()}>{connection.connected ? "Reconnect Withings" : "Connect Withings"}</button>
          {connection.connected && <button type="button" className="btn secondary" disabled={working || loading} onClick={() => void disconnect()}>Disconnect Withings</button>}
        </div>
      </>)}
      <div role="status">{loading ? "Loading Withings..." : message}</div>
      {authorizationFailed && <p role="alert">Withings authorization did not finish. Choose Connect Withings to try again.</p>}
      {connection?.lastError && !error && <p role="alert">{connection.lastError}</p>}
      {error && <><p role="alert">{error}</p><button type="button" className="btn secondary" disabled={working || loading} onClick={() => void load()}>Retry loading</button></>}
    </section>
    <section className="card" aria-label="Weight measurements">
      <h2 className="card-title">Weight measurements</h2>
      <p className="hint">Kilograms, with each reading's time in the Withings timezone. Imported measurements stay in your backup after disconnecting.</p>
      <WeightReadings items={items} />
      {!loading && !items.length && !error && <p>No weight measurements imported yet. Connect Withings, then choose Sync now to fetch your readings.</p>}
      {cursor && <button type="button" className="btn secondary" disabled={loading || working} onClick={() => void load(cursor)}>Load more</button>}
    </section>
  </>;
}

export function DayWeight({ date }: { date: string }) {
  const [items, setItems] = useState<WeightMeasurement[]>([]);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const version = useRef(0);
  const load = async (next?: Cursor) => {
    const current = ++version.current; setLoading(true); setError(false);
    try {
      const page = await request(trpc.withings.measurements.query({ from: date, to: date, limit: 200, cursor: next }));
      if (current === version.current) { setItems((previous) => next ? [...previous, ...page.items] : page.items); setCursor(page.nextCursor); }
    } catch { if (current === version.current) setError(true); }
    finally { if (current === version.current) setLoading(false); }
  };
  useEffect(() => { setItems([]); setCursor(null); void load(); return () => { version.current++; }; }, [date]);
  if (!items.length && !error) return null;
  return <section className="card" aria-label="Body weight">
    <h2 className="card-title">Body weight</h2>
    <p className="hint">From Withings</p>
    <WeightReadings items={items} />
    {error && <><p role="alert">Unable to load weight. Check your connection and retry.</p><button type="button" className="btn secondary" disabled={loading} onClick={() => void load()}>Retry weight</button></>}
    {cursor && <button type="button" className="btn secondary" disabled={loading} onClick={() => void load(cursor)}>More weight readings</button>}
  </section>;
}
