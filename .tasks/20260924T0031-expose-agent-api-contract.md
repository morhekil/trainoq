---
title: Expose a usable API contract to LLM agents
created_at: 2026-09-24T00:31:00+10:00
---

`createTRPCClient<AppRouter>` gives TypeScript callers inferred input and output types, but an LLM agent making HTTP calls does not see those types. Give non-TypeScript callers one small, reliable way to discover and invoke the same tRPC procedures. This may be a typed agent tool wrapper or a machine-readable schema generated from the router; choose based on the first agent runtime, without creating another write API.

Relevant code: `worker/router.ts` `AppRouter`, `shared/schema.ts`, `src/lib/api.ts`, and the API seam section of `README.md`. The tRPC seam is currently uncommitted on top of `61bd8ff`; check the live worktree before implementation. Coordinate credential handling with the separate agent-credentials task.

Acceptance criteria:

- An agent can discover the supported operations and required inputs for the first real workflows, then invoke them through `/api/trpc` with its own credential.
- The contract explains success, validation, authorization, and revision-conflict results. It stays tied to router/schema definitions so it cannot silently drift from the server.
- A runnable example or integration check shows an agent-style caller reading a day and making a validated change through the shared API.
- Browser TypeScript inference and existing tRPC procedures remain intact; no parallel REST mutation path is added.
