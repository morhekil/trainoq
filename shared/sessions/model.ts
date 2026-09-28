import type { SessionItem } from "../exercises/model";

export interface Session {
  id: string;
  startedAt: string; // ISO timestamp
  endedAt: string | null;
  warmup: SessionItem[];
  main: SessionItem[];
  cooldown: SessionItem[];
  /** active calories for the session, entered manually for now */
  calories: number | null;
  notes: string;
  garminSourceKey?: string;
}

/** Anything outside a training session: walk, ride, climbing... */
