import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { formatDateShort } from "../../shared/format";
import { nameKey, type Section } from "../../shared/types";
import { canonicalName, refreshLibrary, searchExercises } from "../lib/library";
import { useLibraryVersion } from "../lib/hooks";
import { Icon } from "./icons";

// ---------- types

export interface SheetAction {
  label: string;
  onClick: () => void;
  danger?: boolean;
  icon?: Parameters<typeof Icon>[0]["name"];
}
interface SheetState {
  title?: string;
  actions: SheetAction[];
}
interface PickerState {
  section: Section;
  title: string;
  initial?: string;
  onPick: (name: string) => void;
}
interface ToastState {
  id: number;
  message: string;
  undo?: () => void;
}

interface Overlays {
  openSheet: (s: SheetState) => void;
  openPicker: (p: PickerState) => void;
  toast: (message: string, undo?: () => void) => void;
}

const Ctx = createContext<Overlays | null>(null);

export function useOverlays(): Overlays {
  const v = useContext(Ctx);
  if (!v) throw new Error("OverlayProvider missing");
  return v;
}

export function OverlayProvider({ children }: { children: ReactNode }) {
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [toastState, setToast] = useState<ToastState | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const toast = useCallback((message: string, undo?: () => void) => {
    clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), message, undo });
    toastTimer.current = setTimeout(() => setToast(null), undo ? 6000 : 2500);
  }, []);

  const value = useMemo<Overlays>(() => ({ openSheet: setSheet, openPicker: setPicker, toast }), [toast]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {sheet && <Sheet state={sheet} onClose={() => setSheet(null)} />}
      {picker && <ExercisePicker state={picker} onClose={() => setPicker(null)} />}
      {toastState && (
        <div className="toast" role="status" key={toastState.id}>
          <span>{toastState.message}</span>
          {toastState.undo && (
            <button
              type="button"
              className="toast-undo"
              onClick={() => {
                toastState.undo?.();
                setToast(null);
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
    </Ctx.Provider>
  );
}

// ---------- action sheet

function Sheet({ state, onClose }: { state: SheetState; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={state.title ?? "Actions"} onClick={(e) => e.stopPropagation()}>
        {state.title && <div className="sheet-title">{state.title}</div>}
        {state.actions.map((a) => (
          <button
            key={a.label}
            type="button"
            className={`sheet-btn ${a.danger ? "danger" : ""}`}
            onClick={() => {
              onClose();
              a.onClick();
            }}
          >
            {a.icon && <Icon name={a.icon} size={18} />}
            {a.label}
          </button>
        ))}
        <button type="button" className="sheet-btn cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------- exercise picker

function ExercisePicker({ state, onClose }: { state: PickerState; onClose: () => void }) {
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
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.classList.add("no-scroll");
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
      document.body.classList.remove("no-scroll");
    };
  }, [onClose]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const groups = useMemo(() => searchExercises(q, state.section), [q, state.section, libVersion]);
  const typed = q.trim();
  const exact = groups.some((g) => g.items.some((i) => i.key === nameKey(typed)));

  const pick = (name: string) => {
    onClose();
    state.onPick(name);
  };

  return (
    <div className="picker" role="dialog" aria-label={state.title}>
      <div className="picker-head">
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
          <Icon name="back" />
        </button>
        <div className="picker-search">
          <Icon name="search" size={18} />
          <input
            ref={inputRef}
            type="search"
            value={q}
            placeholder={state.title}
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
    </div>
  );
}
