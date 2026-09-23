import { createContext, useContext } from "react";
import type { DayDoc } from "../../shared/types";
import type { Update } from "../lib/hooks";

export interface DayCtx {
  date: string;
  doc: DayDoc;
  update: Update;
  /** apply a destructive change and offer Undo */
  undoable: (message: string, fn: (d: DayDoc) => void) => void;
  recentVersion: number;
}

export const DayContext = createContext<DayCtx | null>(null);

export function useDayCtx(): DayCtx {
  const v = useContext(DayContext);
  if (!v) throw new Error("DayContext missing");
  return v;
}
