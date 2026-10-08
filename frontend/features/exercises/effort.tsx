import { EFFORT, type Effort } from "../../../shared/exercises/model";
import { effortLabel } from "../../../shared/exercises/format";

const SPOKEN = { RIR: "reps in reserve", RPE: "effort (RPE)" };

/** One tap records how hard an entry was; tapping the chosen level again clears it. */
export function EffortPicker({ name, scale, value, onChange }: { name: string; scale: "RIR" | "RPE"; value?: Effort; onChange: (value: Effort | undefined) => void }) {
  // RIR "a lot" is only offered once recorded, e.g. after an exercise moves from time to reps.
  const levels = scale === "RIR" ? EFFORT.filter((level) => level !== "low" || value === "low") : EFFORT;
  return <div className="effort" role="group" aria-label={`${name} ${SPOKEN[scale]}`}>
    <span className="effort-scale" aria-hidden="true">{scale}</span>
    {levels.map((level) => <button key={level} type="button" aria-pressed={value === level} onClick={() => onChange(value === level ? undefined : level)}>
      {effortLabel(level, scale)}
    </button>)}
  </div>;
}
