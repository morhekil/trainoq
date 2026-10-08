import type { SessionItem } from "../exercises/model";

export interface Session {
  id: string;
  startedAt: string; // offset timestamp, see shared/days/time.ts
  endedAt: string | null;
  warmup: SessionItem[];
  main: SessionItem[];
  cooldown: SessionItem[];
  /** active calories for the session, entered manually or copied once from Garmin */
  calories: number | null;
  notes: string;
}

/** Anything outside a training session: walk, ride, climbing... */
