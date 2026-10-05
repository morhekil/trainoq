import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { daySummary, formatDateLong } from "../../../shared/days/format";
import { isDayEmpty } from "../../../shared/days/model";
import { request, trpc } from "../../api";
import { cachedDays, getEntry, ingestServerDays } from "./store";
import { goToDate } from "./dates";
import { exerciseName } from "../exercises/catalog";
import { libraryVersion, refreshLibrary, subscribeLibrary } from "../exercises/library";

export function HistoryView() {
  useSyncExternalStore(subscribeLibrary, libraryVersion);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const load = async (before?: string) => {
    setLoading(true);
    try {
      const days = await request(trpc.days.list.query({ limit: 30, before }));
      ingestServerDays(days);
      if (days.length < 30) setDone(true);
    } catch {
      /* offline – show what's cached */
    } finally {
      setLoading(false);
      setVersion((v) => v + 1);
    }
  };

  useEffect(() => {
    void load();
    void refreshLibrary();
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
        const firstComment = [...d.comments].sort((a, b) => a.time.localeCompare(b.time)).find((comment) => comment.text.trim());
        return (
          <button key={d.date} type="button" className="card history-item" onClick={() => goToDate(d.date)}>
            <div className="history-date">
              {formatDateLong(d.date)}
              {e?.dirty && <span className="pill">not synced</span>}
            </div>
            {firstComment && <div className="history-morning">{firstComment.text.trim().split("\n")[0]}</div>}
            <div className="history-summary muted">{daySummary(d, undefined, exerciseName) || "Comments only"}</div>
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
