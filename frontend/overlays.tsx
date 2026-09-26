import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { Section } from "../shared/exercises/model";
import { Icon } from "./icons";
import { Modal } from "./modal";
import { ExercisePicker } from "./features/exercises/picker";

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
export interface PickerState {
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
  return (
    <Modal variant="sheet" label={state.title ?? "Actions"} onClose={onClose}>
      <div className="sheet">
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
    </Modal>
  );
}
