---
title: Add intent-level mutations for agent workflows
created_at: 2026-09-24T00:31:00+10:00
---

Today every persistent edit is possible through `days.get` plus a complete `days.save` document, while the browser's edit rules live in `frontend/features/sessions/ops.ts` and components. Agents should be able to request concrete changes without rebuilding a whole `DayDoc` or duplicating superset and set behavior. Keep the single tRPC router as the control surface and preserve the browser's local-first edits.

Relevant code: `backend/features/days/router.ts` `days.save`, `shared/days/model.ts`, `shared/days/schema.ts`, `shared/sessions/model.ts`, `shared/exercises/model.ts`, `frontend/features/sessions/ops.ts`, `frontend/features/sessions/recent.ts`, `frontend/features/exercises/library.ts`, and the day/session components. Start from actual agent workflows rather than inventing a general patch language.

Acceptance criteria:

- Enumerate the first agent actions against current features: morning and day notes, sessions, warm-up/main/cool-down items, sets and supersets, activities and calories, and repeat/copy. Implement the smallest useful first slice, then file any remaining slices explicitly.
- Each mutation validates its input, applies the same domain rules as the browser (including superset round behavior), checks the day revision, and returns the updated document or a typed conflict. Reuse shared pure edit functions where browser and server both need them.
- Agent actions and browser sync write through the same D1 day persistence path. No second store or REST endpoint is introduced.
- Tests exercise a representative action through the tRPC boundary, including a stale revision and a domain invariant. Offline browser editing and later sync still work.
