import type { SetType, WorkSet } from "./model";

export function formatNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

export function formatSet(s: Pick<WorkSet, "weight" | "reps">): string {
  const w = s.weight == null ? "" : s.weight === 0 ? "BW" : `${formatNum(s.weight)}kg`;
  const r = s.reps == null ? "" : `×${s.reps}`;
  return w + r || "–";
}

const TYPE_LABEL: Record<SetType, string> = { warmup: "warm-up", working: "working", backoff: "back-off" };

/** "warm-up BW×6, 5kg×5 | working 10kg×5 ×3 | back-off BW×9" */
export function formatSets(sets: Pick<WorkSet, "type" | "weight" | "reps">[]): string {
  const filled = sets.filter((s) => s.weight != null || s.reps != null);
  if (filled.length === 0) return "";
  // split into runs of the same type, then group identical consecutive sets
  const runs: { type: SetType; parts: string[] }[] = [];
  let i = 0;
  while (i < filled.length) {
    const s = filled[i];
    let n = 1;
    while (
      i + n < filled.length &&
      filled[i + n].type === s.type &&
      filled[i + n].weight === s.weight &&
      filled[i + n].reps === s.reps
    )
      n++;
    const part = formatSet(s) + (n > 1 ? ` ×${n}` : "");
    const last = runs[runs.length - 1];
    if (last && last.type === s.type) last.parts.push(part);
    else runs.push({ type: s.type, parts: [part] });
    i += n;
  }
  const onlyWorking = runs.length === 1 && runs[0].type === "working";
  if (onlyWorking) return runs[0].parts.join(", ");
  return runs.map((r) => `${TYPE_LABEL[r.type]} ${r.parts.join(", ")}`).join(" | ");
}
