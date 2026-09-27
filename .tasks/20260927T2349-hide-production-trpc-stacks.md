---
title: Hide stack traces in production tRPC errors
parent: 20260927T2251-unify-session-sections
created_at: 2026-09-27T23:49:01+10:00
---

During the production smoke check after deploying commit `12e235e`, an unauthenticated `GET /api/trpc/auth.me` correctly returned HTTP 401 with `UNAUTHORIZED`, but the JSON error also included a server `stack` field with bundled source line numbers. The endpoint is `https://trainoq.morhekil.workers.dev/api/trpc/auth.me`.

Investigate the Worker tRPC error formatting and remove stack traces from production responses while preserving useful error codes and local debugging. Add a regression test for the production Worker boundary.
