---
title: Accept the Withings callback registration probe
status: in-progress
created_at: 2026-11-19T08:40:00+11:00
---

The developer dashboard rejects the deployed OAuth callback URL with HTTP 404. At b61e000, `backend/index.ts:12` routes GET only, so HEAD falls through to 404. Existing API tests construct GET callbacks (`tests/withings-api.test.ts:38-40`); browser tests mock the consent page (`visual/withings.pw.ts:38-47`); the live smoke checked GET authentication only (`/tmp/trainoq-withings-live-smoke.mjs:21`). None covered registration probes.

Add a public, side-effect-free HEAD response on the exact callback path, before session/config checks. Preserve GET session/state checks, other-method rejection, and all token/database behavior. Reproduce through the Worker boundary, verify local and live HTTP HEAD/GET behavior, document, push and deploy the fix so registration can continue.

Provider contract: https://developer.withings.com/developer-guide/v3/integration-guide/onsite-mode/data-api/notifications/notification-subscribe/
