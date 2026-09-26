# Trainoq project notes

- Keep `frontend/` (React), `backend/` (Cloudflare Worker), and `shared/` at the same level. Organise each by feature; avoid `lib` or other catch-all folders.
- All app data uses the typed tRPC API at `/api/trpc`. `backend/router.ts` composes feature routers. The browser uses `frontend/api.ts` and imports `AppRouter` only as a type. Keep browser and future agent clients on this API, and update `API.md` when its contract changes.
- A `DayDoc` is the source of truth in D1. `exercise_log` is rebuilt from it. The browser saves edits locally first, then syncs whole days through `days.save`; preserve offline drafts and conflict resolution when changing this flow.
- `backend/features/days/db.ts` currently checks the revision before its write batch. That check is not atomic, so simultaneous writers can overwrite each other. Resolve `.tasks/20260924T0031-make-day-writes-atomic.md` before enabling concurrent agent writes.
- Agent credentials, intent-level mutations, and a discoverable contract for non-TypeScript agents are tracked in `.tasks/`. Extend the existing router for those workflows.
- For code changes, use red/green/refactor, update documentation with behavior, then run focused tests, `npm run typecheck`, `npm test`, and `npm run build`. Verify API changes through the Worker boundary.
