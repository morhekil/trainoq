---
title: Steady the custom exercise name screenshot test
created_at: 2026-10-08T19:40:00+11:00
---

`visual/screenshots.pw.ts` "a custom exercise name appears when its catalog record arrives" failed once in a full `npm run screenshots:check` run on master at `9f1935b` (8 Oct), at `await expect(share).toContainText("Custom raise")`. It passed 3/3 alone (`--repeat-each 3`) and in every later full run. The share text likely reads the catalog before the mocked record arrives on a slow run. Make the test wait for the catalog record, or make the share sheet re-render when it arrives.
