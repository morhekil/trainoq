---
title: Connect Garmin activities for recurring import
status: in-progress
created_at: 2026-09-28T23:15:16+10:00
---

The Garmin review currently accepts FIT files, but Garmin Connect exports recordings one at a time. Add a recurring in-app connection that signs in to Garmin, pages through activity IDs, downloads original FIT exports, and imports them through the existing summary and review flow. Support an initial backfill and later syncs. Keep credentials and tokens encrypted at rest, account for MFA and expired sessions, and preserve idempotent source imports and local day decisions. Verify the Worker boundary, pagination, duplicate handling, and sign-in failures without logging secrets.
