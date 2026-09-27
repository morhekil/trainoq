import type { PerformedExercise, SessionItem, SetType, StandaloneExercise, Superset, WorkSet } from "../exercises/model";

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
    members: [{ id: exercise.id, exerciseId: exercise.exerciseId, comment: exercise.comment }],
    rounds: exercise.sets.map(({ id, type }) => ({ id, type })),
    results: exercise.sets.map(({ id, weight, reps }) => ({ memberId: exercise.id, roundId: id, weight, reps })),
  };
  items.splice(index, 1, superset);
  return superset;
}

export function addMember(superset: Superset, member: PerformedExercise): void {
  if (superset.members.some((m) => m.id === member.id)) throw new Error("Duplicate member ID");
  superset.members.push(member);
  for (const round of superset.rounds) superset.results.push({ memberId: member.id, roundId: round.id, weight: null, reps: null });
}

export function removeMember(superset: Superset, memberId: string): void {
  superset.members = superset.members.filter((m) => m.id !== memberId);
  superset.results = superset.results.filter((r) => r.memberId !== memberId);
}

export function moveMember(superset: Superset, memberId: string, to: number): void {
  move(superset.members, superset.members.findIndex((m) => m.id === memberId), to);
}

export function addRound(superset: Superset, roundId: string, type: SetType): void {
  if (superset.rounds.some((r) => r.id === roundId)) throw new Error("Duplicate round ID");
  superset.rounds.push({ id: roundId, type });
  for (const member of superset.members) superset.results.push({ memberId: member.id, roundId, weight: null, reps: null });
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

export function memberAsExercise(superset: Superset, member: PerformedExercise): StandaloneExercise {
  return {
    kind: "exercise", ...member,
    sets: superset.rounds.map((round) => {
      const result = superset.results.find((r) => r.memberId === member.id && r.roundId === round.id);
      return { ...round, weight: result?.weight ?? null, reps: result?.reps ?? null };
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
  addMember(superset, { id: exercise.id, exerciseId: exercise.exerciseId, comment: exercise.comment });
  if (!matching) for (const set of exercise.sets) addRound(superset, superset.rounds.some((r) => r.id === set.id) ? `${set.id}:${exercise.id}` : set.id, set.type);
  exercise.sets.forEach((set, i) => {
    const roundId = matching ? superset.rounds[i].id : superset.rounds[superset.rounds.length - exercise.sets.length + i].id;
    const result = superset.results.find((r) => r.memberId === exercise.id && r.roundId === roundId)!;
    result.weight = set.weight;
    result.reps = set.reps;
  });
  items.splice(from, 1);
}

export function addSet(exercise: StandaloneExercise, set: WorkSet): void { exercise.sets.push(set); }
export function removeSet(exercise: StandaloneExercise, setId: string): void { exercise.sets = exercise.sets.filter((set) => set.id !== setId); }
