import type { SetType } from "./model";
import { DEFAULT_PARAMS, PARAMS, type Param, type ParamSet, type ParamValues } from "./params";

export function formatNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

export function formatValue(param: Param, value: number): string {
  switch (param) {
    case "weight": return value === 0 ? "BW" : `${formatNum(value)}kg`;
    case "reps": return `×${formatNum(value)}`;
    case "time": return value < 120 ? `${formatNum(value)}s` : `${Math.floor(value / 60)}:${String(Math.round(value % 60)).padStart(2, "0")}`;
    case "band": return `band ${formatNum(value)}`;
    case "distance": return value < 1000 ? `${formatNum(value)}m` : `${formatNum(value / 1000)}km`;
    default: return `${formatNum(value)}${PARAMS[param].unit}`;
  }
}

export function formatSet(set: ParamValues, params: ParamSet = DEFAULT_PARAMS): string {
  const lead = params.perSet.filter((key) => key !== "reps" && set[key] != null).map((key) => formatValue(key, set[key]!)).join(" ");
  const reps = params.perSet.includes("reps") && set.reps != null ? formatValue("reps", set.reps) : "";
  return lead + reps || "–";
}

export function formatSetup(setup: ParamValues | undefined, params: ParamSet): string {
  return (params.setup ?? []).filter((key) => setup?.[key] != null)
    .map((key) => `${PARAMS[key].column.toLowerCase()} ${formatValue(key, setup![key]!)}`).join(", ");
}

const TYPE_LABEL: Record<SetType, string> = { warmup: "warm-up", working: "working", backoff: "back-off" };

/** "warm-up BW×6, 5kg×5 | working 10kg×5 ×3 | back-off BW×9" */
export function formatSets(sets: ({ type: SetType } & ParamValues)[], params: ParamSet = DEFAULT_PARAMS): string {
  const filled = sets.filter((set) => params.perSet.some((key) => set[key] != null));
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
      params.perSet.every((key) => filled[i + n][key] === s[key])
    )
      n++;
    const part = formatSet(s, params) + (n > 1 ? ` ×${n}` : "");
    const last = runs[runs.length - 1];
    if (last && last.type === s.type) last.parts.push(part);
    else runs.push({ type: s.type, parts: [part] });
    i += n;
  }
  const onlyWorking = runs.length === 1 && runs[0].type === "working";
  if (onlyWorking) return runs[0].parts.join(", ");
  return runs.map((r) => `${TYPE_LABEL[r.type]} ${r.parts.join(", ")}`).join(" | ");
}
