import type { SessionExercise, SessionItem, SetType, StandaloneExercise, Superset, WorkSet } from "../exercises/model";
import { normalizeParams, PARAM_KEYS, valuesOf, type Param, type ParamSet, type ParamValues } from "../exercises/params";

export function move<T>(items: T[], from: number, to: number): void {
  if (from < 0 || from >= items.length || to < 0 || to >= items.length) return;
  items.splice(to, 0, items.splice(from, 1)[0]);
}

export function createSuperset(items: SessionItem[], exerciseId: string, supersetId: string): Superset {
  const index = items.findIndex((item) => item.id === exerciseId && item.kind === "exercise");
  if (index < 0) throw new Error("Standalone exercise not found");
  const exercise = items[index] as StandaloneExercise;
  const superset: Superset = {
    kind: "superset", id: supersetId,
    members: [{ id: exercise.id, exerciseId: exercise.exerciseId, comment: exercise.comment, params: exercise.params, ...(exercise.setup ? { setup: exercise.setup } : {}) }],
    rounds: exercise.sets.map(({ id, type }) => ({ id, type })),
    results: exercise.sets.map(({ id, ...set }) => ({ memberId: exercise.id, roundId: id, ...valuesOf(set, exercise.params) })),
  };
  items.splice(index, 1, superset);
  return superset;
}

export function addMember(superset: Superset, member: SessionExercise): void {
  if (superset.members.some((m) => m.id === member.id)) throw new Error("Duplicate member ID");
  superset.members.push(member);
  for (const round of superset.rounds) superset.results.push({ memberId: member.id, roundId: round.id, ...valuesOf(undefined, member.params) });
}

export function removeMember(superset: Superset, memberId: string): void {
  superset.members = superset.members.filter((m) => m.id !== memberId);
  superset.results = superset.results.filter((r) => r.memberId !== memberId);
}

export function moveMember(superset: Superset, memberId: string, to: number): void {
  move(superset.members, superset.members.findIndex((m) => m.id === memberId), to);
}

export function addRound(superset: Superset, roundId: string, type: SetType, copyLast = true): void {
  if (superset.rounds.some((r) => r.id === roundId)) throw new Error("Duplicate round ID");
  const previousRoundId = superset.rounds.at(-1)?.id;
  superset.rounds.push({ id: roundId, type });
  for (const member of superset.members) {
    const previous = copyLast ? superset.results.find((r) => r.memberId === member.id && r.roundId === previousRoundId) : undefined;
    superset.results.push({ memberId: member.id, roundId, ...valuesOf(previous, member.params) });
  }
}

export function setRoundType(superset: Superset, roundId: string, type: SetType): void {
  const round = superset.rounds.find((r) => r.id === roundId);
  if (!round) throw new Error("Round not found");
  round.type = type;
}

export function reorderRound(superset: Superset, roundId: string, to: number): void {
  move(superset.rounds, superset.rounds.findIndex((r) => r.id === roundId), to);
}

export function removeRound(superset: Superset, roundId: string): void {
  superset.rounds = superset.rounds.filter((r) => r.id !== roundId);
  superset.results = superset.results.filter((r) => r.roundId !== roundId);
}

export function memberAsExercise(superset: Superset, member: SessionExercise): StandaloneExercise {
  return {
    kind: "exercise", ...member,
    sets: superset.rounds.map((round) => {
      const result = superset.results.find((r) => r.memberId === member.id && r.roundId === round.id);
      return { ...round, ...valuesOf(result, member.params) };
    }),
  };
}

export function takeOutMember(items: SessionItem[], supersetId: string, memberId: string): void {
  const index = items.findIndex((item) => item.id === supersetId && item.kind === "superset");
  if (index < 0) throw new Error("Superset not found");
  const superset = items[index] as Superset;
  const member = superset.members.find((m) => m.id === memberId);
  if (!member) throw new Error("Member not found");
  const exercise = memberAsExercise(superset, member);
  removeMember(superset, memberId);
  items.splice(index + 1, 0, exercise);
}

export function dissolveSuperset(items: SessionItem[], supersetId: string): void {
  const index = items.findIndex((item) => item.id === supersetId && item.kind === "superset");
  if (index < 0) throw new Error("Superset not found");
  const superset = items[index] as Superset;
  items.splice(index, 1, ...superset.members.map((member) => memberAsExercise(superset, member)));
}

export function deleteSuperset(items: SessionItem[], supersetId: string): void {
  const index = items.findIndex((item) => item.id === supersetId && item.kind === "superset");
  if (index < 0) throw new Error("Superset not found");
  items.splice(index, 1);
}

/** Matching types map by order. Append preserves mismatched sets as new rounds. */
export function joinPerformance(items: SessionItem[], exerciseId: string, supersetId: string, alignment?: "append"): void {
  const from = items.findIndex((item) => item.id === exerciseId && item.kind === "exercise");
  const superset = items.find((item) => item.id === supersetId && item.kind === "superset") as Superset | undefined;
  if (from < 0 || !superset) throw new Error("Performance or superset not found");
  const exercise = items[from] as StandaloneExercise;
  const matching = exercise.sets.length === superset.rounds.length && exercise.sets.every((set, i) => set.type === superset.rounds[i].type);
  if (!matching && alignment !== "append") throw new Error("Align set types before joining");
  const { kind: _kind, sets: _sets, ...member } = exercise;
  addMember(superset, member);
  if (!matching) for (const set of exercise.sets) addRound(superset, superset.rounds.some((r) => r.id === set.id) ? `${set.id}:${exercise.id}` : set.id, set.type, false);
  exercise.sets.forEach((set, i) => {
    const roundId = matching ? superset.rounds[i].id : superset.rounds[superset.rounds.length - exercise.sets.length + i].id;
    const result = superset.results.find((r) => r.memberId === exercise.id && r.roundId === roundId)!;
    Object.assign(result, valuesOf(set, member.params));
  });
  items.splice(from, 1);
}

export function addSet(exercise: StandaloneExercise, set: WorkSet): void { exercise.sets.push(set); }
export function removeSet(exercise: StandaloneExercise, setId: string): void { exercise.sets = exercise.sets.filter((set) => set.id !== setId); }

function recordOf(item: SessionItem, memberId: string): SessionExercise {
  const record = item.kind === "exercise" ? item : item.members.find((member) => member.id === memberId);
  if (!record || record.id !== memberId) throw new Error("Member not found");
  return record;
}
const rowsOf = (item: SessionItem, memberId: string): ParamValues[] => item.kind === "exercise"
  ? item.sets : item.results.filter((result) => result.memberId === memberId);

export function removedValues(item: SessionItem, memberId: string, next: ParamSet): { param: Param; count: number }[] {
  const record = recordOf(item, memberId);
  const lost = record.params.perSet.filter((key) => !next.perSet.includes(key))
    .map((param) => ({ param, count: rowsOf(item, memberId).filter((row) => row[param] != null).length }));
  for (const param of record.params.setup ?? [])
    if (!next.setup?.includes(param) && record.setup?.[param] != null) lost.push({ param, count: 1 });
  return lost.filter((entry) => entry.count > 0);
}

export function setRecordParams(item: SessionItem, memberId: string, next: ParamSet): void {
  const record = recordOf(item, memberId);
  const params = normalizeParams(next);
  record.params = params;
  for (const row of rowsOf(item, memberId)) {
    for (const key of PARAM_KEYS) if (!params.perSet.includes(key)) delete row[key];
    Object.assign(row, valuesOf(row, params));
  }
  if (params.setup) record.setup = Object.fromEntries(params.setup.map((key) => [key, record.setup?.[key] ?? null]));
  else delete record.setup;
}
