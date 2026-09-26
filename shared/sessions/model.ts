import type { Block, SimpleItem } from "../exercises/model";

export interface Session {
  id: string;
  startedAt: string; // ISO timestamp
  endedAt: string | null;
  warmup: SimpleItem[];
  main: Block[];
  cooldown: SimpleItem[];
  /** active calories for the session, entered manually for now */
  calories: number | null;
  notes: string;
}

/** Anything outside a training session: walk, ride, climbing... */
