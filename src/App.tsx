import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { dayToText, daySummary, formatDateLong, formatDateShort } from "../shared/format";
import { isDayEmpty } from "../shared/types";
import { DayView } from "./components/day";
import { Icon, type IconName } from "./components/icons";
import { OverlayProvider, useOverlays } from "./components/overlays";
import { api, AuthError, onAuthRequired } from "./lib/api";
import { useOnline, useSyncStatus } from "./lib/hooks";
import { refreshLibrary } from "./lib/library";
import { cachedDays, clearLocalData, getEntry, hasUnsynced, ingestServerDays, syncAll, type StoredDay, type SyncStatus } from "./lib/store";
import { addDays, lsGet, lsSet, todayLocal } from "./lib/util";

// ---------------------------------------------------------------- routing (hash based)

type Route = { view: "day"; date: string | null } | { view: "history" };

function parseHash(): Route {
  const h = location.hash.replace(/^#\/?/, "");
  if (h === "history") return { view: "history" };
  const m = h.match(/^d\/(\d{4}-\d{2}-\d{2})$/);
  return { view: "day", date: m ? m[1] : null };
}

function useRoute(): Route {
  const hash = useSyncExternalStore(
    (cb) => {
      window.addEventListener("hashchange", cb);
      return () => window.removeEventListener("hashchange", cb);
    },
    () => location.hash,
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(parseHash, [hash]);
}

export function goToDate(date: string) {
  location.hash = date === todayLocal() ? "#/" : `#/d/${date}`;
}

/** Today's date, refreshed when the app comes back to the foreground (e.g. next morning). */
function useToday(): string {
  const [today, setToday] = useState(todayLocal);
  useEffect(() => {
    const check = () => setToday(todayLocal());
    document.addEventListener("visibilitychange", check);
    const t = setInterval(check, 60000);
    return () => {
      document.removeEventListener("visibilitychange", check);
      clearInterval(t);
    };
  }, []);
  return today;
}

// ---------------------------------------------------------------- app

type Auth = "checking" | "in" | "out";

export default function App() {
  const [auth, setAuth] = useState<Auth>(lsGet<boolean>("tq:authed") ? "in" : "checking");

  useEffect(() => {
    const off = onAuthRequired(() => {
      lsSet("tq:authed", false);
      setAuth("out");
    });
    api("/api/me")
      .then((r) => {
        if (r.ok) {
          lsSet("tq:authed", true);
          setAuth("in");
        }
      })
      .catch((e) => {
        if (e instanceof AuthError) setAuth("out");
        else if (!lsGet<boolean>("tq:authed")) setAuth("out");
      });
    return off;
  }, []);

  if (auth === "checking") return <div className="splash">Trainoq</div>;
  if (auth === "out")
    return (
      <Login
        onDone={() => {
          lsSet("tq:authed", true);
          setAuth("in");
          syncAll();
          void refreshLibrary(true);
        }}
      />
    );
  return (
    <OverlayProvider>
      <Main onSignedOut={() => setAuth("out")} />
    </OverlayProvider>
  );
}

function Main({ onSignedOut }: { onSignedOut: () => void }) {
  const route = useRoute();
  const today = useToday();
  const online = useOnline();
  const [sharing, setSharing] = useState<string | null>(null);
  const { openSheet, toast } = useOverlays();

  const date = route.view === "day" ? (route.date ?? today) : today;

  const appMenu = () =>
    openSheet({
      actions: [
        { label: "History", icon: "history", onClick: () => (location.hash = "#/history") },
        { label: "Share this day", icon: "share", onClick: () => setSharing(date) },
        { label: "Download backup (JSON)", icon: "download", onClick: () => window.open("/api/export", "_blank") },
        {
          label: "Sign out",
          icon: "logout",
          onClick: async () => {
            if (hasUnsynced()) {
              toast("Some changes haven't synced yet – connect and try again");
              return;
            }
            try {
              await api("/api/logout", { method: "POST" });
            } catch {
              /* ignore */
            }
            clearLocalData();
            lsSet("tq:authed", false);
            onSignedOut();
          },
        },
      ],
    });

  return (
    <div className="app">
      {route.view === "history" ? (
        <header className="topbar">
          <button type="button" className="icon-btn" aria-label="Back" onClick={() => (location.hash = "#/")}>
            <Icon name="back" />
          </button>
          <div className="topbar-title">History</div>
          <SyncBadge />
        </header>
      ) : (
        <DayHeader date={date} today={today} onMenu={appMenu} />
      )}
      {!online && <div className="offline-bar">Offline – everything is saved on this phone and syncs when you're back online.</div>}
      <main className="content">
        {route.view === "history" ? (
          <HistoryView />
        ) : (
          <>
            <DayView key={date} date={date} />
            <button type="button" className="btn big secondary share-btn" onClick={() => setSharing(date)}>
              <Icon name="share" size={18} />
              Share day with PT / physio
            </button>
          </>
        )}
      </main>
      {sharing && <ShareSheet date={sharing} onClose={() => setSharing(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------- header

function relativeLabel(date: string, today: string): string | null {
  if (date === today) return "Today";
  if (date === addDays(today, -1)) return "Yesterday";
  if (date === addDays(today, 1)) return "Tomorrow";
  return null;
}

function DayHeader({ date, today, onMenu }: { date: string; today: string; onMenu: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const rel = relativeLabel(date, today);
  return (
    <header className="topbar">
      <button type="button" className="icon-btn" aria-label="Previous day" onClick={() => goToDate(addDays(date, -1))}>
        <Icon name="left" />
      </button>
      <div className="date-picker">
        <div className="date-main">{rel ?? formatDateShort(date)}</div>
        <div className="date-sub">{rel ? formatDateShort(date) : date.slice(0, 4)}</div>
        <input
          ref={inputRef}
          type="date"
          aria-label="Pick a date"
          value={date}
          onClick={() => {
            try {
              inputRef.current?.showPicker();
            } catch {
              /* native tap handles it */
            }
          }}
          onChange={(e) => e.target.value && goToDate(e.target.value)}
        />
      </div>
      <button type="button" className="icon-btn" aria-label="Next day" onClick={() => goToDate(addDays(date, 1))}>
        <Icon name="right" />
      </button>
      <div className="topbar-spacer" />
      {date !== today && (
        <button type="button" className="btn small secondary" onClick={() => goToDate(today)}>
          Today
        </button>
      )}
      <SyncBadge />
      <button type="button" className="icon-btn" aria-label="Menu" onClick={onMenu}>
        <Icon name="more" />
      </button>
    </header>
  );
}

const STATUS: Record<SyncStatus, [IconName | null, string, string]> = {
  saved: ["check", "Saved", "All changes saved"],
  saving: [null, "Saving", "Saving changes"],
  offline: ["cloudOff", "Offline", "Saved on this device – will sync when online"],
  error: ["alert", "Retrying", "Couldn't save to the server – retrying"],
  conflict: ["alert", "Conflict", "This day was changed on another device"],
};

function SyncBadge() {
  const status = useSyncStatus();
  const [icon, label, title] = STATUS[status];
  return (
    <div className={`sync ${status}`} role="status" aria-live="polite" title={title} onClick={() => syncAll()}>
      {icon ? <Icon name={icon} size={14} /> : <span className="spinner" aria-hidden="true" />}
      <span>{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------- history

function HistoryView() {
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const load = async (before?: string) => {
    setLoading(true);
    try {
      const res = await api(`/api/days?limit=30${before ? `&before=${before}` : ""}`);
      if (res.ok) {
        const { days } = (await res.json()) as { days: StoredDay[] };
        ingestServerDays(days);
        if (days.length < 30) setDone(true);
      }
    } catch {
      /* offline – show what's cached */
    } finally {
      setLoading(false);
      setVersion((v) => v + 1);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const days = useMemo(
    () =>
      cachedDays()
        .map((e) => e.doc)
        .filter((d) => !isDayEmpty(d))
        .sort((a, b) => b.date.localeCompare(a.date)),
    [version],
  );

  return (
    <div className="history">
      {days.length === 0 && !loading && <div className="empty">Nothing logged yet.</div>}
      {days.map((d) => {
        const e = getEntry(d.date);
        return (
          <button key={d.date} type="button" className="card history-item" onClick={() => goToDate(d.date)}>
            <div className="history-date">
              {formatDateLong(d.date)}
              {e?.dirty && <span className="pill">not synced</span>}
            </div>
            {d.morning.trim() && <div className="history-morning">{d.morning.trim().split("\n")[0]}</div>}
            <div className="history-summary muted">{daySummary(d) || "Notes only"}</div>
          </button>
        );
      })}
      {!done && days.length > 0 && (
        <button type="button" className="btn ghost" disabled={loading} onClick={() => load(days[days.length - 1].date)}>
          {loading ? "Loading…" : "Load older"}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- share

function ShareSheet({ date, onClose }: { date: string; onClose: () => void }) {
  const { toast } = useOverlays();
  const doc = getEntry(date)?.doc;
  const text = doc ? dayToText(doc) : formatDateLong(date);
  const canShare = typeof navigator.share === "function";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied");
    } catch {
      toast("Couldn't copy – select the text and copy it");
    }
  };

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="sheet share" role="dialog" aria-label="Share day" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-title">Share {formatDateShort(date)}</div>
        <pre className="share-text" data-testid="share-text">
          {text}
        </pre>
        <div className="share-actions">
          {canShare && (
            <button
              type="button"
              className="btn primary"
              onClick={() => navigator.share({ title: `Training – ${formatDateLong(date)}`, text }).catch(() => {})}
            >
              <Icon name="share" size={18} />
              Share…
            </button>
          )}
          <button type="button" className={`btn ${canShare ? "secondary" : "primary"}`} onClick={copy}>
            <Icon name="copy" size={18} />
            Copy text
          </button>
        </div>
        <button type="button" className="sheet-btn cancel" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- login

function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api("/api/login", { method: "POST", body: JSON.stringify({ password }) });
      if (res.ok) onDone();
      else setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Sign-in failed");
    } catch {
      setError("Can't reach the server – check your connection");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="login" onSubmit={submit}>
      <div className="login-mark" aria-hidden="true">
        <img src="/icon-192.png" alt="" width={64} height={64} />
      </div>
      <h1>Trainoq</h1>
      <input
        className="text"
        type="password"
        autoComplete="current-password"
        placeholder="Password"
        aria-label="Password"
        value={password}
        autoFocus
        onChange={(e) => setPassword(e.target.value)}
      />
      {error && <div className="login-error">{error}</div>}
      <button type="submit" className="btn big primary" disabled={busy || !password}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
