---
title: Add separate credentials for agent clients
priority: high
created_at: 2026-09-24T00:31:00+10:00
---

The current tRPC router authenticates data procedures through the browser's long-lived signed cookie, issued after `auth.login` checks the single `APP_PASSWORD`. Agent clients need their own revocable credentials so they can call the same procedures without receiving the browser password or sharing its cookie.

Relevant code: `worker/auth.ts` `isAuthed` and `sessionCookie`, `worker/router.ts` auth middleware and procedures, `worker/index.ts` request context, and `src/lib/api.ts`. The tRPC seam is currently uncommitted on top of `61bd8ff`; check the live worktree before implementation. Complete atomic day writes before enabling simultaneous agent mutations.

Acceptance criteria:

- An agent can authenticate to `/api/trpc` with a credential distinct from `APP_PASSWORD`; browser cookie sign-in continues to work.
- Credentials identify the agent, can be revoked or rotated, and are not stored or logged in plaintext after issuance. Decide the smallest useful permission scope from the first real agent workflows.
- The same authorization boundary applies to every data procedure, including backup export and future mutations. Unauthorized calls fail without data access.
- Tests cover valid, invalid, and revoked agent credentials plus existing browser cookie behavior. Document issuance, use, and revocation without putting secrets in the repository.
