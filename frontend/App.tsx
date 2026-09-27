import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Login } from "./features/auth/login";
import { DayView } from "./features/days/day";
import { DayHeader, SyncBadge } from "./features/days/header";
import { HistoryView } from "./features/days/history";
import { ShareSheet } from "./features/days/share";
import { useToday } from "./features/days/dates";
import { Icon } from "./icons";
import { OverlayProvider, useOverlays } from "./overlays";
import { request, trpc } from "./api";
import { AuthError, onAuthRequired } from "./features/auth/session";
import { refreshLibrary } from "./features/exercises/library";
import { clearLocalData, hasUnsynced, syncAll } from "./features/days/store";
import { clearLibrary } from "./features/exercises/library";
import { lsGet, lsSet } from "./storage";

// ---------------------------------------------------------------- routing (hash based)

type Route = { view: "day"; date: string | null } | { view: "history" };

function useOnline() {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("online", cb);
      window.addEventListener("offline", cb);
      return () => {
        window.removeEventListener("online", cb);
        window.removeEventListener("offline", cb);
      };
    },
    () => navigator.onLine,
  );
}

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

// ---------------------------------------------------------------- app

type Auth = "checking" | "in" | "out";

export default function App() {
  const [auth, setAuth] = useState<Auth>(lsGet<boolean>("tq:authed") ? "in" : "checking");

  useEffect(() => {
    const off = onAuthRequired(() => {
      lsSet("tq:authed", false);
      setAuth("out");
    });
    request(trpc.auth.me.query())
      .then(() => {
        lsSet("tq:authed", true);
        setAuth("in");
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

  const downloadBackup = async () => {
    try {
      const backup = await request(trpc.backup.export.query());
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `trainoq-export-${backup.exportedAt.slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      toast("Couldn't download backup – check your connection");
    }
  };

  const appMenu = () =>
    openSheet({
      actions: [
        { label: "History", icon: "history", onClick: () => (location.hash = "#/history") },
        { label: "Share this day", icon: "share", onClick: () => setSharing(date) },
        { label: "Download backup (JSON)", icon: "download", onClick: () => void downloadBackup() },
        {
          label: "Sign out",
          icon: "logout",
          onClick: async () => {
            if (hasUnsynced()) {
              toast("Some changes haven't synced yet – connect and try again");
              return;
            }
            try {
              await request(trpc.auth.logout.mutate());
            } catch {
              /* ignore */
            }
            clearLocalData();
            clearLibrary();
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
          <h1 className="topbar-title">History</h1>
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
