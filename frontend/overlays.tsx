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
  const [toasts, setToasts] = useState<ToastState[]>([]);
  const nextToastId = useRef(0);

  const toast = useCallback((message: string, undo?: () => void) => {
    setToasts((current) => [...current, { id: ++nextToastId.current, message, undo }]);
  }, []);

  const value = useMemo<Overlays>(() => ({ openSheet: setSheet, openPicker: setPicker, toast }), [toast]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {sheet && <Sheet state={sheet} onClose={() => setSheet(null)} />}
      {picker && <ExercisePicker state={picker} onClose={() => setPicker(null)} />}
      {toasts.length > 0 && (
        <div className="toast-stack">
          {toasts.map((item) => (
            <div className="toast" role={item.undo ? "status" : "alert"} key={item.id}>
              <span>{item.message}</span>
              {item.undo && (
                <button type="button" className="toast-action" onClick={() => {
                  item.undo?.();
                  setToasts((current) => current.filter((toast) => toast.id !== item.id));
                }}>Undo</button>
              )}
              <button type="button" className="toast-action" aria-label="Dismiss message" onClick={() => {
                setToasts((current) => current.filter((toast) => toast.id !== item.id));
              }}>Dismiss</button>
            </div>
          ))}
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
