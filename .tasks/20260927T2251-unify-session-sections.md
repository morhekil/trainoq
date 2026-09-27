---
title: Unify exercise blocks across session sections
created_at: 2026-09-27T22:51:22+10:00
---

## Goal

Warm-up, Main, and Cool-down use the same exercise, set, block, and superset behavior. The section is context and a label, not a different exercise model. This is a model refactor before adding further exercise features.

## Current setup at `4cf5f68`

- `shared/sessions/model.ts` stores `warmup` and `cooldown` as `SimpleItem[]`, but `main` as `Block[]`. `shared/exercises/model.ts` gives a simple item one free-text `reps` field; a main exercise has typed sets with numeric weight and reps. `shared/days/schema.ts` validates this split in `DayDoc` v1.
- `frontend/features/sessions/session.tsx` has separate `SimpleSection`/`SimpleRow` and `MainSection`/`BlockCard`/`ExerciseEditor` flows. Only main can make supersets or enter set weight and reps. `frontend/features/sessions/ops.ts` looks up blocks only in `main`; repeat copies simple reps but drops main sets. `frontend/features/sessions/recent.ts` has separate repeat source types.
- `shared/sessions/format.ts` shares simple entries differently from blocks. `backend/features/days/db.ts` writes different `exercise_log.detail` shapes, and `backend/features/exercises/db.ts` returns set history only for main. `frontend/features/exercises/library.ts` likewise gives last-time set hints only from main.
- D1 stores whole day JSON; `exercise_log` is derived. The browser also stores days, dirty state, revision base, and conflict copies in localStorage (`frontend/features/days/store.ts`). `days.save` validates the whole document at the Worker boundary. Backups export stored days.
- `tests/ops.test.ts` checks superset rounds only on a standalone main-style `Block`. `tests/format.test.ts` and `visual/screenshots.pw.ts` encode the simple warm-up/cool-down shape. There is no test that can create a superset outside main because the schema and editor have no such path.

## Target shape and decisions

- Keep the three ordered session properties, but make **each one `Block[]`**. A block has one or more exercises; two or more form a superset. Rename `MainExercise` to `Exercise` and remove `SimpleItem` and the simple-section branch. Use the existing block and round operations with a `Section` argument. Do not add a second store or a generic section framework.
- Give every exercise the same set fields: `type`, `weight: number | null`, and `reps: string | null`, plus the existing exercise comment. A string preserves legacy values such as `30s` and `2x15`; existing numeric main reps convert to decimal strings. Keep numeric stepping for numeric values and allow free text for other values in the shared editor. The set type (`warmup`/`working`/`backoff`) is independent of the session section.
- Use one section editor and the same add, rename, move, split, delete, undo, superset, round, set, and comment controls in all three places. Pass the section to picker/search and last-time lookup; the heading and suggestions remain contextual labels.
- Scope last-time values by section and exercise name so a main load is not suggested for the same exercise in warm-up. Use the same history mechanism for all sections. Repeat copies exercise names, block grouping, and set types, but clears recorded weight/reps in every section. This deliberately replaces the old simple-section repeat behavior, which copied reps, and avoids presenting copied values as a newly performed session.

## Implementation sequence

1. **Lock down conversion first (red/green).** Add v1 fixtures covering empty entries, comments, order, supersets, numeric main reps, and free-text simple reps. Bump `DayDoc` to v2 and write one pure, deterministic v1-to-v2 normalizer in `shared/days/`. A legacy simple item becomes a one-exercise block with one `working` set, null weight, and its original reps text; derive stable block/set IDs from its existing ID. Preserve existing exercise IDs and comments. Conversion must be idempotent for v2.
2. **Read and save one canonical shape.** Normalize D1 `days.get`/`days.list`, backup output, local cached entries, and both sides of a conflict before they reach app logic. Preserve each local entry's `dirty`, `base`, `rev`, and conflict metadata. Accept v1 during the transition at `days.save`, normalize it, and persist v2. Existing D1 days can convert on read and on their next save; no bulk rewrite or new table is needed. Verify a dirty offline v1 draft can sync after an upgrade.
3. **Unify domain operations and UI.** Change `Session` and Zod to three `Block[]` properties. Make block lookup and edits section-aware in the existing operations module. Replace the simple editor with the existing block editor parameterized by section. Preserve the shared round invariant: all exercises in a superset have the same set count/types, while weight and reps belong to each exercise. Update repeat to use one block path.
4. **Update all consumers.** Make text sharing and exercise counting traverse blocks in each section. Write one `exercise_log.detail` set shape for new saves. Update library history and local last-time lookup to cover all sections, including old log rows with `{ reps }`; keep the existing section-scoped picker ranking. Update `API.md`, `README.md` where behavior is described, fixtures, and screenshot data in the same change. Coordinate with `.tasks/20260924T0031-add-agent-intent-mutations.md` so later agent actions reuse the unified operations.
5. **Verify at the boundaries.** Run focused conversion, operations, formatting, and library tests red then green. Exercise old and new documents through the real Worker tRPC boundary, including save/get/list/export, stale-base conflict, and legacy log history. Capture the current screenshot baseline before UI edits; after edits run `npm run screenshots:check`, inspect narrow and desktop views in both themes, and deliberately update affected baselines. Check keyboard access, labels, focus, undo, repeat, and scroll reachability for warm-up and cool-down supersets. Finish with `npm run typecheck`, `npm test`, `npm run build`, and the matching Worker/UI smoke flow.

## Done when

- Each section can create and edit a single exercise or superset with identical weight, reps, set-type, round, ordering, and deletion behavior.
- Existing v1 days, unsynced drafts, conflict copies, backup data, free-text reps, and comments remain readable without loss. v2 is the only new persisted shape.
- History, suggestions, repeat, share text, and exercise counts work for all three sections through one model and one editor.
- The Worker/API, focused tests, full checks, and rendered interaction checks pass; documentation and fixtures describe v2.
