/** Registry order is also the display and storage order for parameter sets. */
export const PARAMS = {
  height: { name: "Box height", column: "Box in", unit: "in", spoken: "box height in inches", step: 2, decimal: false, scope: "set" },
  edge: { name: "Edge", column: "Edge mm", unit: "mm", spoken: "edge in millimetres", step: 5, decimal: false, scope: "set" },
  distance: { name: "Distance", column: "m", unit: "m", spoken: "distance in metres", step: 100, decimal: false, scope: "set" },
  weight: { name: "Weight", column: "kg", unit: "kg", spoken: "weight", step: 2.5, decimal: true, scope: "set" },
  time: { name: "Time", column: "Sec", unit: "s", spoken: "seconds", step: 5, decimal: false, scope: "set" },
  reps: { name: "Reps", column: "Reps", unit: "", spoken: "reps", step: 1, decimal: false, scope: "set" },
  angle: { name: "Bench angle", column: "Bench", unit: "°", spoken: "bench angle in degrees", step: 5, decimal: false, scope: "setup" },
} as const;
export type Param = keyof typeof PARAMS;
export const PARAM_KEYS = Object.keys(PARAMS) as Param[];
export interface ParamSet { perSet: Param[]; setup?: Param[] }
export type ParamValues = Partial<Record<Param, number | null>>;
export const DEFAULT_PARAMS: ParamSet = { perSet: ["weight", "reps"] };

export const PARAM_TEMPLATES: ParamSet[] = [
  { perSet: ["weight", "reps"] },
  { perSet: ["reps"] },
  { perSet: ["time"] },
  { perSet: ["time", "reps"] },
  { perSet: ["weight", "time"] },
  { perSet: ["height", "reps"] },
  { perSet: ["edge", "time", "reps"] },
  { perSet: ["distance", "time"] },
  { setup: ["angle"], perSet: ["weight", "reps"] },
];

const ordered = (keys: readonly Param[]) => PARAM_KEYS.filter((key) => keys.includes(key));
export function normalizeParams(params: ParamSet): ParamSet {
  const setup = ordered(params.setup ?? []);
  return setup.length ? { setup, perSet: ordered(params.perSet) } : { perSet: ordered(params.perSet) };
}
export const paramsKey = (params: ParamSet) => [params.setup?.join(","), params.perSet.join(",")].filter(Boolean).join("|");
export const sameParams = (a: ParamSet, b: ParamSet) => paramsKey(a) === paramsKey(b);
const phrase = (keys: Param[]) => keys.map((key, index) => index ? PARAMS[key].name.toLowerCase() : PARAMS[key].name).join(" × ");
export function paramsName(params: ParamSet): string {
  return params.setup?.length ? `${phrase(params.setup)}, ${phrase(params.perSet).toLowerCase()}` : phrase(params.perSet);
}
export function valuesOf(source: ParamValues | undefined, params: ParamSet): ParamValues {
  return Object.fromEntries(params.perSet.map((key) => [key, source?.[key] ?? null]));
}
