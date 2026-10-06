import { useState } from "react";
import { PARAMS, PARAM_TEMPLATES, paramsKey, paramsName, sameParams, type Param, type ParamSet } from "../../../shared/exercises/params";
import { Modal } from "../../modal";

export interface ParamsSheetState {
  exerciseName: string;
  current: ParamSet;
  removed?: (next: ParamSet) => { param: Param; count: number }[];
  rowNoun?: "set" | "round";
  note: string;
  onApply: (next: ParamSet) => void;
}

export function removalText(lost: { param: Param; count: number }[], noun: "set" | "round"): string {
  const parts = lost.map(({ param, count }) => param === "angle" ? PARAMS[param].name.toLowerCase() : `${PARAMS[param].name.toLowerCase()} from ${count} ${noun}${count === 1 ? "" : "s"}`);
  return `Removes ${parts.join(" and ")}.`;
}

export function ParamsSheet({ state, onClose }: { state: ParamsSheetState; onClose: () => void }) {
  const options = PARAM_TEMPLATES;
  const list = options.some((option) => sameParams(option, state.current)) ? options : [state.current, ...options];
  const [selected, setSelected] = useState(state.current);
  const lost = state.removed?.(selected) ?? [];
  const title = `${state.exerciseName} parameters`;
  return <Modal variant="sheet" label={title} onClose={onClose}>
    <form className="sheet params-sheet" onSubmit={(event) => { event.preventDefault(); onClose(); if (!sameParams(selected, state.current)) state.onApply(selected); }}>
      <h2 className="sheet-title">{title}</h2>
      <fieldset className="params-options">
        <legend>Templates</legend>
        {list.map((option) => <label key={paramsKey(option)} className="params-option">
          <input type="radio" name="params" checked={sameParams(option, selected)} autoFocus={sameParams(option, state.current)} onChange={() => setSelected(option)} />
          <span>{paramsName(option)}</span>
          <span className="params-columns" aria-hidden="true">{option.perSet.map((key) => PARAMS[key].column).join(" · ")}</span>
        </label>)}
      </fieldset>
      {lost.length > 0 && <p className="sheet-description warn">{removalText(lost, state.rowNoun ?? "set")}</p>}
      <p className="sheet-description">{state.note}</p>
      <button type="submit" className="sheet-btn primary">Use {paramsName(selected)}</button>
      <button type="button" className="sheet-btn cancel" onClick={onClose}>Cancel</button>
    </form>
  </Modal>;
}
