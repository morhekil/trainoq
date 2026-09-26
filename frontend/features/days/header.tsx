import { useRef } from "react";
import { formatDateShort } from "../../../shared/days/format";
import { Icon, type IconName } from "../../icons";
import { addDays, goToDate } from "./dates";
import { useSyncStatus } from "./hooks";
import { syncAll, type SyncStatus } from "./store";

function relativeLabel(date: string, today: string): string | null {
  if (date === today) return "Today";
  if (date === addDays(today, -1)) return "Yesterday";
  if (date === addDays(today, 1)) return "Tomorrow";
  return null;
}

export function DayHeader({ date, today, onMenu }: { date: string; today: string; onMenu: () => void }) {
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

export function SyncBadge() {
  const status = useSyncStatus();
  const [icon, label, title] = STATUS[status];
  const indicator = <>{icon ? <Icon name={icon} size={14} /> : <span className="spinner" aria-hidden="true" />}<span>{label}</span></>;
  return (
    <div className={`sync ${status}`} role="status" aria-live="polite" title={title}>
      {status === "error" || status === "offline" ? (
        <button type="button" className="sync-retry" aria-label={`${label}. Retry sync`} onClick={syncAll}>{indicator}</button>
      ) : indicator}
    </div>
  );
}
