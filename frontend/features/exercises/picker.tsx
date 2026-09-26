import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { formatDateShort } from "../../../shared/days/format";
import { nameKey } from "../../../shared/exercises/model";
import { Icon } from "../../icons";
import { Modal } from "../../modal";
import type { PickerState } from "../../overlays";
import { canonicalName, libraryVersion, refreshLibrary, searchExercises, subscribeLibrary } from "./library";

function useLibraryVersion() {
  return useSyncExternalStore(subscribeLibrary, libraryVersion);
}

// ---------- exercise picker

export function ExercisePicker({ state, onClose }: { state: PickerState; onClose: () => void }) {
  const [q, setQ] = useState(state.initial ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const libVersion = useLibraryVersion();

  useEffect(() => {
    void refreshLibrary();
    // focus after mount so iOS opens the keyboard
    const t = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 30);
    return () => {
      clearTimeout(t);
    };
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const groups = useMemo(() => searchExercises(q, state.section), [q, state.section, libVersion]);
  const typed = q.trim();
  const exact = groups.some((g) => g.items.some((i) => i.key === nameKey(typed)));

  const pick = (name: string) => {
    onClose();
    state.onPick(name);
  };

  return (
    <Modal variant="picker" label={state.title} onClose={onClose}>
      <div className="picker-head">
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
          <Icon name="back" />
        </button>
        <div className="picker-search-field">
          <label className="picker-label" htmlFor="exercise-search">{state.title}</label>
          <div className="picker-search">
            <Icon name="search" size={18} />
            <input
              id="exercise-search"
              ref={inputRef}
              type="search"
              value={q}
              autoComplete="off"
              autoCorrect="off"
              enterKeyHint="done"
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && typed) pick(canonicalName(typed));
              }}
            />
            {q && (
              <button type="button" className="icon-btn small" aria-label="Clear" onClick={() => setQ("")}>
                <Icon name="x" size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="picker-list">
        {typed && !exact && (
          <button type="button" className="picker-item use-typed" onClick={() => pick(canonicalName(typed))}>
            <Icon name="plus" size={18} />
            <span>
              Use "<strong>{typed}</strong>"
            </span>
          </button>
        )}
        {groups.map((g) => (
          <div key={g.title}>
            {!typed && <div className="picker-group">{g.title}</div>}
            {g.items.map((i) => (
              <button key={i.key} type="button" className="picker-item" onClick={() => pick(i.name)}>
                <span className="picker-name">{i.name}</span>
                {i.last && (
                  <span className="picker-meta">
                    {i.total}× · {formatDateShort(i.last)}
                  </span>
                )}
              </button>
            ))}
          </div>
        ))}
        {typed && !groups[0]?.items.length && <div className="picker-empty">No matches – use what you typed and it'll be saved for next time.</div>}
      </div>
    </Modal>
  );
}
