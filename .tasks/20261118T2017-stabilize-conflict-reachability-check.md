---
title: Stabilize the conflict action reachability check
parent: 20261118T2001-add-withings-weight-sync
created_at: 2026-11-18T20:17:00+11:00
---

The pre-change screenshot run on 2026-11-18 passed 70 of 71 scenarios, but `visual/screenshots.pw.ts:369` failed its Share reachability assertion at 320px. This test scrolls immediately after navigation and reads `elementFromPoint` once (`:380-386`); `frontend/App.tsx` also resets scroll in a requestAnimationFrame after route changes. Verify the timing and distinguish a real obstruction from an unsettled page, then keep a test that detects persistent obstruction. Evidence: `/tmp/trainoq-before-matched-baseline.log`.
