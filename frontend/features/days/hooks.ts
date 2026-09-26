import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { emptyDay, type DayDoc } from "../../../shared/days/model";
import { getEntry, getStatus, loadFromServer, setDoc, subscribeDay, subscribeStatus } from "./store";

export type Update = (fn: (d: DayDoc) => void) => void;

export function useDay(date: string) {
  const entry = useSyncExternalStore(
    useCallback((cb) => subscribeDay(date, cb), [date]),
    () => getEntry(date),
  );
  const blank = useMemo(() => emptyDay(date), [date]);

  useEffect(() => {
    void loadFromServer(date);
    const onVisible = () => {
      if (document.visibilityState === "visible") void loadFromServer(date);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [date]);

  const update: Update = useCallback(
    (fn) => {
      const cur = getEntry(date)?.doc ?? emptyDay(date);
      const next = structuredClone(cur);
      fn(next);
      setDoc(date, next);
    },
    [date],
  );

  const replace = useCallback((doc: DayDoc) => setDoc(date, doc), [date]);

  return { doc: entry?.doc ?? blank, entry, update, replace };
}

export function useSyncStatus() {
  return useSyncExternalStore(subscribeStatus, getStatus);
}
