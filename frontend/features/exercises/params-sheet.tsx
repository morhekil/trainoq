import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { PARAMS, PARAM_KEYS, PARAM_TEMPLATES, normalizeParams, paramsName, sameParams, type Param, type ParamSet } from "../../../shared/exercises/params";
import { Modal } from "../../modal";
import { libraryVersion, subscribeLibrary } from "./library";
import { saveLocalTemplate, templatesFor } from "./params";

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
  useSyncExternalStore(subscribeLibrary, libraryVersion);
  const builtins = PARAM_TEMPLATES.map((params, index) => ({ id: `builtin:${index}`, name: paramsName(params), params }));
  const currentBuiltin = builtins.find((option) => sameParams(option.params, state.current));
  const options = currentBuiltin ? builtins : [{ id: "current", name: paramsName(state.current), params: state.current }, ...builtins];
  const [choice, setChoice] = useState(currentBuiltin?.id ?? "current");
  const [perSet, setPerSet] = useState<Param[]>(state.current.perSet);
  const [setup, setSetup] = useState<Param[]>(state.current.setup ?? []);
  const [templateName, setTemplateName] = useState("");
  const [error, setError] = useState(false);
  const customRef = useRef<HTMLFieldSetElement>(null);
  const customRadioRef = useRef<HTMLInputElement>(null);
  const initialRadioRef = useRef<HTMLInputElement>(null);
  useEffect(() => { initialRadioRef.current?.focus(); }, []);
  useEffect(() => { if (choice === "custom") customRadioRef.current?.scrollIntoView({ block: "nearest" }); }, [choice]);
  const saved = templatesFor();
  const list = [...options, ...saved.map((template) => ({ id: `saved:${template.id}`, name: template.name, params: template.params }))];
  const selected = choice === "custom" ? normalizeParams({ perSet, setup }) : list.find((option) => option.id === choice)?.params ?? state.current;
  const lost = state.removed?.(selected) ?? [];
  const title = `${state.exerciseName} parameters`;
  const toggle = (key: Param, list: Param[], setList: (next: Param[]) => void) => {
    setList(list.includes(key) ? list.filter((value) => value !== key) : [...list, key]);
    setError(false);
  };
  return <Modal variant="sheet" label={title} onClose={onClose}>
    <form className="sheet params-sheet" onSubmit={(event) => {
      event.preventDefault();
      if (choice === "custom" && perSet.length === 0) { setError(true); customRef.current?.focus(); return; }
      if (choice === "custom" && templateName.trim()) saveLocalTemplate({ id: crypto.randomUUID(), name: templateName.trim(), params: selected });
      onClose();
      if (!sameParams(selected, state.current)) state.onApply(selected);
    }}>
      <h2 className="sheet-title">{title}</h2>
      <div className="params-options-scroll"><fieldset className="params-options">
        <legend>Templates</legend>
        {list.map((option, index) => <div key={option.id}>
          {index === options.length && <div className="params-group-title">Your templates</div>}
          <label className="params-option">
          <input ref={option.id === (currentBuiltin?.id ?? "current") ? initialRadioRef : undefined} type="radio" name="params" checked={choice === option.id} onChange={() => setChoice(option.id)} />
          <span>{option.name}</span>
          <span className="params-columns" aria-hidden="true">{option.params.perSet.map((key) => PARAMS[key].column).join(" · ")}</span>
        </label>
        </div>)}
        <label className="params-option"><input ref={customRadioRef} type="radio" name="params" checked={choice === "custom"} onChange={() => setChoice("custom")} /><span>Custom</span></label>
      </fieldset></div>
      {choice === "custom" && <div className="params-builder">
        <fieldset ref={customRef} tabIndex={-1} aria-invalid={error}>
          <legend>Each set, up to 3</legend>
          <div className="params-checks">{PARAM_KEYS.filter((key) => PARAMS[key].scope === "set").map((key) => <label key={key}>
            <input type="checkbox" checked={perSet.includes(key)} disabled={!perSet.includes(key) && perSet.length >= 3} onChange={() => toggle(key, perSet, setPerSet)} />{PARAMS[key].column}
          </label>)}</div>
          {perSet.length >= 3 && <p>Choose up to 3. Clear one to pick another.</p>}
          {error && <p role="alert">Choose at least one value for each set.</p>}
        </fieldset>
        <fieldset><legend>Once per entry</legend><label><input type="checkbox" checked={setup.includes("angle")} onChange={() => toggle("angle", setup, setSetup)} />{PARAMS.angle.column}</label></fieldset>
        <label className="params-save-label">Save as template (optional)<input className="text" type="text" maxLength={60} value={templateName} onChange={(event) => setTemplateName(event.target.value)} /></label>
      </div>}
      {lost.length > 0 && <p className="sheet-description warn">{removalText(lost, state.rowNoun ?? "set")}</p>}
      <p className="sheet-description">{state.note}</p>
      <button type="submit" className="sheet-btn primary">Use {paramsName(selected)}</button>
      <button type="button" className="sheet-btn cancel" onClick={onClose}>Cancel</button>
    </form>
  </Modal>;
}
