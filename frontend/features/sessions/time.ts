/** ISO timestamp -> "HH:MM" in local time */
export function isoToHHMM(iso: string): string {
  const t = new Date(iso);
  return `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
}

/** date + local "HH:MM" -> ISO timestamp */
export function hhmmToIso(date: string, hhmm: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm).toISOString();
}
