---
title: Rework exercise identity and superset editing
priority: high
status: in-progress
created_at: 2026-09-28T00:36:22+10:00
---

The current `shared/exercises/model.ts` stores an exercise name alongside the comment and sets from one session. Every item is wrapped in a `Block`, and `frontend/features/sessions/session.tsx` treats `block.exercises.length > 1` as the definition of a superset. Removing its second-to-last member silently turns it into a standalone exercise. The right-side set/round delete buttons are easy to hit by accident; deleting a superset round removes recorded values from every member. Keep Undo, but remove that immediate delete target.

Current data and UI seams: `shared/days/{model,schema,migrate}.ts`, `shared/sessions/{model,format}.ts`, `shared/exercises/{model,catalog,seed}.ts`, `frontend/features/sessions/ops.ts`, `frontend/features/sessions/session.tsx`, `frontend/features/exercises/library.ts`, `frontend/features/exercises/picker.tsx`, `frontend/features/days/store.ts`, `backend/features/{days,exercises}/`, `migrations/0001_init.sql`, `API.md`, `README.md`, `tests/{ops,migrate,api,exercises}.test.ts`, and `visual/screenshots.pw.ts`. At filing, the worktree was clean at `326fe37` on `master`.

## Target model

Separate the canonical exercise from one performance. `Exercise { id, name }` belongs to a catalog; search aliases and section hints are catalog metadata. A session section contains an ordered `SessionItem[]` discriminated union:

```ts
type PerformedExercise = { id: string; exerciseId: string; comment: string };
type SetValues = { weight: number | null; reps: number | null };
type SessionItem =
  | (PerformedExercise & {
      kind: "exercise";
      sets: (SetValues & { id: string; type: SetType })[];
    })
  | {
      kind: "superset";
      id: string;
      members: PerformedExercise[];
      rounds: { id: string; type: SetType }[];
      results: (SetValues & { memberId: string; roundId: string })[];
    };
```

`members`, `rounds`, and `results` are sibling collections. Member and round arrays carry display order; result array order has no meaning. `(memberId, roundId)` is the result's key. Validate unique member/round IDs, valid exercise references, and exactly one result per member-round pair with no extras. A superset remains a superset with zero, one, or many members. It may retain round types when emptied. `null` means no recorded value; zero weight remains bodyweight.

## Implementation sequence

1. **Lock the behavior down first.** Under the project's TDD workflow, add failing model/operation tests for empty and one-member supersets, pair validation, type changes, round reorder, member moves, dissolve, and lossless value conversion. Add a browser test that rejects an inline delete button on set rows. Keep the pre-change automated screenshots as the visual baseline.
2. **Add stable exercise identity and migrate the document.** Assign explicit, stable IDs to seed exercises. Generate IDs for newly typed custom exercises on the device so they can be used offline. Add a D1 exercise catalog and migrate existing names using a deterministic normalized-name mapping, including unsynced local drafts and conflict copies. Version the day document (v3); accept and normalize existing v1/v2 data without changing draft revision bases or dropping comments, set types, weights, or reps. Old single-member blocks cannot be identified as former supersets and migrate as standalone items. Gate old-client writes so a v2 save cannot erase a v3 superset.
3. **Keep one typed API surface.** Expose catalog records and custom creation through the existing tRPC router. Cache custom definitions locally; sync a definition before any `days.save` document that references it. Reject unresolved exercise IDs at the server boundary. Rebuild the derived `exercise_log` by exercise ID; key history and suggestions by that ID, with the catalog resolving names. Include catalog records in backup export and document all contract changes in `API.md`. Keep `DayDoc` as the source of truth for performances.
4. **Implement pure editing operations.** Put rules shared by browser and future agent mutations in the matching shared feature. Support explicit create, dissolve, and delete superset actions; add, take out, and delete members; add, type, reorder, and delete rounds; and add/delete standalone sets. Dissolving creates standalone items with the same recorded comments and values. Deleting a superset is distinct and undoable. Joining an existing performance with matching round types can map by order; a mismatch needs an explicit alignment preview and confirmation before any recorded data changes. Never silently overwrite weight or reps.
5. **Update the editor.** Remove right-side delete crosses from both standalone sets and superset round rows. Use a round drag handle; show highlighted, labelled insertion targets for valid round drops, and move the shared round and its results as one logical unit. Dragging an existing exercise onto its section's `+ Superset` creates a durable superset containing it, with no picker. Show a drop target for adding another existing exercise to a superset. Keep an action-sheet path for move and delete by keyboard and touch. Use `+ Set` only on a standalone exercise and `+ Round` only on a superset, including a one-member superset. Each adds the last type, or warm-up when empty. Tapping the index still cycles type and briefly shows the new type beside it, with an accessible announcement. Defer the optional drag-to-delete target; deletion stays in the deliberate action sheet with Undo.
6. **Verify each boundary.** Run the smallest relevant test red, then focused tests, then `npm run typecheck`, `npm test`, and `npm run build`. Exercise a migrated v3 day, catalog creation, validation, and conflict through the Worker tRPC boundary. Verify offline custom creation, reconnect order, repeat, share, history, backup, and a persisted empty/one-member superset. Run `npm run screenshots:check`, inspect affected 320px and desktop images in both themes, update baselines deliberately, and check touch drag, keyboard/focus, 200% zoom, scrolling, drop-target text and contrast, and reduced motion. Update `README.md` with user behavior in the same change. Fix any pre-existing broken tests in a separate commit.

The existing `.tasks/20260924T0031-make-day-writes-atomic.md` remains the prerequisite before concurrent agent writes. `.tasks/20260924T0031-add-agent-intent-mutations.md` should reuse these shared operations when that work starts.

## Done when

- Exercise names and identities live in the catalog; each day stores only performance references and values.
- A standalone performance has no redundant `Block` or `exercises[]` wrapper, and a superset stores members, rounds, and results at the same level.
- Removing the last or second-to-last member leaves the superset intact. Create, dissolve, and delete are explicit and have distinct consequences.
- Round reorder and type changes preserve every member's recorded weight and reps; the result-pair invariant holds after every edit and save.
- The editor has no immediate right-side delete cross, no picker opens on an exercise drop onto `+ Superset`, and valid drop targets highlight during drag.
- Existing saved days and unsynced drafts migrate without data loss; offline sync, API clients, history, repeat, share, and backup use the new model.
- Focused, full, Worker-boundary, screenshot, and interaction checks above pass; documentation reflects the shipped behavior.
