// Stored times are "YYYY-MM-DDTHH:MM:SS±HH:MM": the clock digits as recorded, plus the UTC offset where they were recorded.
// Display reads the digits; sorting and durations parse the instant.

const pad = (n: number) => String(n).padStart(2, "0");

/** "HH:MM" as recorded */
export const clockTime = (ts: string): string => ts.slice(11, 16);

/** "5:02pm" as recorded */
export function formatTime(ts: string): string {
  const [h, m] = clockTime(ts).split(":").map(Number);
  return `${h % 12 || 12}:${pad(m)}${h < 12 ? "am" : "pm"}`;
}

/** 600 → "+10:00" */
export function formatOffset(minutes: number): string {
  const abs = Math.abs(minutes);
  return `${minutes < 0 ? "-" : "+"}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

const offsetMinutes = (offset: string) => (offset[0] === "-" ? -1 : 1) * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6)));

export const atClock = (date: string, hhmm: string, offset: string): string => `${date}T${hhmm}:00${offset}`;
/** An edited time keeps its date and offset. */
export const withClock = (ts: string, hhmm: string): string => atClock(ts.slice(0, 10), hhmm, ts.slice(19));

/** The same instant, written with the clock digits at `offset`. */
export function withOffset(utcIso: string, offset: string): string {
  return new Date(Date.parse(utcIso) + offsetMinutes(offset) * 60_000).toISOString().slice(0, 19) + offset;
}

/** This device's offset at a local date and time. */
export function deviceOffset(date: string, hhmm: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  return formatOffset(-new Date(y, m - 1, d, hh, mm).getTimezoneOffset());
}

export const nowLocal = (now = new Date()): string => withOffset(now.toISOString(), formatOffset(-now.getTimezoneOffset()));
