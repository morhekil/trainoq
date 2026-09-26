import { useEffect, useState } from "react";

/** Local calendar date on this device, YYYY-MM-DD */
export function todayLocal(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export function goToDate(date: string) {
  location.hash = date === todayLocal() ? "#/" : `#/d/${date}`;
}

/** Today's date, refreshed when the app comes back to the foreground (e.g. next morning). */
export function useToday(): string {
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
