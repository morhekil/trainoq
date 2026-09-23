---
title: Make day revision checks and writes atomic
priority: high
created_at: 2026-09-24T00:31:00+10:00
---

`days.save` promises a conflict when its `base` revision is stale. In the current worktree, `worker/db.ts` `putDay` reads `updated_at` before the D1 write batch. Two clients saving the same base can both pass that check, and the last write can silently replace the first. This must be fixed before browser and agent clients write simultaneously.

Relevant code: `worker/db.ts` `putDay`, `worker/router.ts` `days.save`, `src/lib/store.ts` conflict resolution, `migrations/0001_init.sql`, and `tests/api.test.ts`. The tRPC seam is currently uncommitted on top of `61bd8ff`; check the live worktree before implementation.

Acceptance criteria:

- The revision comparison and day write happen atomically in D1. A stale `base` returns the current server copy and changes neither `days` nor `exercise_log`.
- Of two concurrent saves from the same base, exactly one succeeds. Cover first-write races, updates, and deletion of an empty day.
- `exercise_log` always describes the winning day document. Revision tokens remain unique enough that two fast saves cannot appear to have the same revision.
- The browser's offline queue and mine/theirs conflict flow keep working. Verify with a D1-backed concurrency check and the existing tRPC tests.

Keep the `days.save` contract unless a necessary revision-token change requires an explicit migration plan.
