---
title: Download Garmin activity FIT files in bulk
status: in-progress
created_at: 2026-09-28T23:15:16+10:00
---

The Garmin review currently accepts many FIT files in one selection, but Garmin Connect exports recordings one at a time. Add a local client that signs in interactively, pages through all activity IDs, downloads and unzips original FIT exports, and resumes without downloading completed files again. Keep account credentials and raw health files out of the repository and Trainoq's Worker. Document the one-selection import into Trainoq and test pagination, resume, and invalid exports without a live Garmin account.
