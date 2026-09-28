---
title: Investigate and implement Garmin activity import with active calories
status: in-progress
created_at: 2026-09-28T18:30:16+10:00
---

## Goal and hard constraint

Bring Garmin runs, walks, tennis and other recorded activities into Trainoq with their time of day, duration and **active calories**. Link Garmin strength recordings to existing Trainoq sessions when the match is clear; otherwise allow them to become activities. Let the user correct values and links, or ignore individual Garmin records. Trainoq edits always win over later imports.

Garmin's displayed "Activity Calories" can include resting calories. That number does not satisfy this task. Do not substitute it for active calories, estimate active calories by subtracting resting expenditure, or silently import it into a field labelled active calories. See [Garmin's calorie definitions](https://support.garmin.com/en-AU/?faq=lkl4cwCLlK7ox362uGQEV7).

## Phase 0: inspect actual Garmin data before designing the importer

Audit on 2026-09-28: Garmin Connect's `Export CSV` supplied `Activities.csv` (20 visible rows). `Calories` was total activity calories, not active calories; `Date` was local text without an offset, and the CSV had no source ID. Original `Export File` downloads supplied FIT files for run (`24523901155`), walk (`24511727768`), tennis (`24327475649`) and strength (`24525690096`). These remain in Downloads and are not checked into the repository.

| Recording | FIT `session.totalCalories` | FIT `session.metabolicCalories` | Connect resting | Connect active | FIT `session.totalTimerTime` |
| --- | ---: | ---: | ---: | ---: | ---: |
| Run | 207 kcal | 35 kcal | 35 kcal | 172 kcal | 1561.339 s |
| Walk | 99 kcal | 35 kcal | 35 kcal | 64 kcal | 1549.030 s |
| Tennis | 479 kcal | 82 kcal | 82 kcal | 397 kcal | 3617.467 s |
| Strength | 487 kcal | 125 kcal | 125 kcal | 362 kcal | 5522.563 s |

The original FIT files pass Garmin's integrity check. FIT has no per-session `activeCalories` field in these samples; its `metabolicCalories` matches Connect's per-activity resting calories exactly, and `totalCalories - metabolicCalories` matches Connect's active calories in all four. The user explicitly approved this verified calculation on 2026-09-28. Require both source fields and reject missing or inconsistent values; do not use an estimated resting rate or daily active total.

FIT `session.startTime` is UTC. `activity.localTimestamp` gives the local clock reading at the file's first session, yielding a +10:00 offset in these samples. `totalElapsedTime` and `totalTimerTime` differ for strength (5668.773 s versus 5522.563 s); the latter matches Connect's displayed activity time. `session.sport`/`subSport` distinguish the four sports. FIT `sportProfileName` is generic (`Run`, `Walk`, `Tennis`, `Strength`); custom Connect titles such as `Sydney Running` occur in the CSV but are not in these FIT files. FIT `fileId.serialNumber` plus `fileId.timeCreated` survives a repeat export of the run, which had identical FIT bytes. A separate multisport FIT (`24490389650`) has two session messages; do not silently sum them. No changed export, manually created Garmin activity, corrupt file, local-midnight activity or travel-day sample was available in this audit. FIT `activity.type = manual` occurred even in the four device recordings, so it does not identify a Connect-created manual activity.

Selected format: an unzipped original FIT file. `shared/garmin/fit.ts` validates file integrity and emits one summary per session, using `fileId.serialNumber`, `fileId.timeCreated` and `session.messageIndex` for source identity. It rejects sessions without both calorie fields. The parser produced the four Connect-checked active values and two separate multisport summaries from the downloaded files.

No Garmin export was available in the repository or Downloads on 2026-09-28. Obtain representative real exports for a run, walk, tennis session and strength session, including one recording the user can compare with Garmin Connect. Inspect the actual fields and values in the activity CSV, original FIT files and any relevant wellness export the user can provide. Record the source file, field name, units and an example value for:

- Per-activity **active** calories, distinguished from activity/total calories and daily active calories. Cross-check against the value Garmin Connect shows for the same recording.
- Start time, local date or time-zone information, elapsed time, timer time and any missing values. Check an activity near midnight or on a travel day if one is available.
- Sport/sub-sport, custom title if present, and a stable source identity that survives exporting the same activity again. Inspect duplicate and changed exports if available.
- Multiple sessions in one FIT file, manual Garmin activities and corrupted or incomplete files if present in the sample.

**Go/no-go gate:** If none of the available sources exposes a trustworthy per-activity active calorie value, stop before adding schema, API or UI code. Report the observed fields and the gap to the user. Do not turn a daily active total or a total activity calorie value into a per-activity value by guesswork. Decide whether there is another authorized data source before resuming. Choose the import format only after this audit; FIT is a candidate because Garmin exports original FIT files and provides a JavaScript decoder, but its actual fields must be checked first. See [Garmin export options](https://support.garmin.com/en-US/?faq=W1TvTPW8JZ6LfJSfK512Q8) and [FIT SDK](https://developer.garmin.com/fit/get-the-sdk/).

## Proposed model, conditional on Phase 0

Keep Garmin source records independent from Trainoq day documents:

1. Add D1 `garmin_activities` with a verified stable `source_key` primary key; sport, start UTC, source local date/offset when available, elapsed/timer duration, active calories, import time and a summary hash. Preserve missing source values as null. Store only the fields needed for this feature, not GPS tracks or heart-rate samples. A repeat import is a no-op when unchanged; a changed source updates this row without changing a Trainoq day. If the export lacks stable identity, send potential duplicates to review rather than inventing a match.
2. Migrate `DayDoc` from v4 to v5. Add an optional start time to `Activity`; keep its existing duration and calories fields. Add an optional Garmin source key to a `Session` or `Activity`, plus ignored Garmin source keys on the day. Existing manual activities remain valid with no start time or source. Keep the source key with the editable item so links and ignore decisions follow the existing local-first `days.save` and conflict flow. Update `isDayEmpty` so ignored decisions are not lost.
3. Add a small derived `garmin_links` index rebuilt from saved days, with a unique source key and the decision's day, target kind and target ID (or ignored status). This supports pending/linked/ignored queries and prevents one Garmin record being accepted twice. Only accepted Trainoq items enter the existing derived `exercise_log`; source-only and ignored records do not.

The saved Trainoq time, duration, exercise choice and active calories are the effective values. Applying a link copies available Garmin values once. Later imports never overwrite those fields, including when the user has changed them. Keep the raw Garmin value visible beside the corrected Trainoq value in review. Unlinking leaves the Trainoq item intact and makes the Garmin record pending; deleting a linked item likewise makes the source pending unless explicitly ignored.

Before link decisions can be saved from more than one device, complete [make day writes atomic](20260924T0031-make-day-writes-atomic.md). A `days.save` must atomically update the day and both derived indexes, and reject a stale revision without changing any of them. Current `putDay` checks the revision before its D1 write batch (`backend/features/days/db.ts:54-90`).

## Proposed API and interaction

- Add an authenticated `garmin` feature router under `/api/trpc`: `garmin.import` accepts bounded, validated activity summaries from the chosen parser and returns inserted, unchanged, updated and rejected counts; `garmin.list({ from, to })` returns source values and pending/linked/ignored status. Keep file decoding out of the ordinary day view and load any FIT parser only on import.
- Apply a link, create an activity or ignore a record by editing the local `DayDoc` and using `days.save`. Do not let `garmin.import` write days directly, since another device may have an unsynced draft. Use the existing revision conflict UI if a day changed elsewhere.
- Suggest a strength match only when the local date and time yield one clear existing completed session. Show ambiguous matches for explicit choice. Preserve the session ID, exercises, sets and notes. An unmatched strength recording can become an activity. Offer bulk acceptance for unambiguous non-strength activities; let every record be ignored or restored.
- Show each imported record's source time, duration and active calories, proposed Trainoq destination and current decision. Keep naming and date corrections editable after acceptance. Do not silently aggregate multiple FIT sessions or choose elapsed versus timer duration without Phase 0 evidence.
- Extend `backup.export` to include imported Garmin summaries. Update `API.md` and `README.md` with the new model, procedures, calorie meaning, import format, re-import behavior and correction rules.

## Delivery and acceptance

Develop each slice with red/green/refactor. Start with focused tests for source parsing and active-calorie identification, stable identity/re-import, missing fields and time zones. Then cover one clear and one ambiguous strength match, activity creation, ignore/restore, unlink/delete, manual correction surviving a changed re-import, offline drafts and concurrent day-save conflicts. Verify API procedures through the Worker boundary.

Run the focused tests, `npm run typecheck`, `npm test` and `npm run build`. For rendered changes, capture screenshot baselines before editing; run `npm run screenshots:check`, inspect affected images at narrow and desktop widths in both themes, and check keyboard access, visible focus, labels, conflict and error recovery. The feature is done when an actual Garmin sample imports with verified **per-activity active calories**, repeat imports make no duplicates, corrections persist, ignored records stay ignored, backup includes the sources, and docs describe the shipped behavior.

Current code references at `80f4fdd`: `shared/days/model.ts`, `shared/sessions/model.ts`, `shared/exercises/model.ts`, `frontend/features/days/store.ts`, `frontend/features/days/day.tsx`, `backend/features/days/db.ts`, `backend/router.ts`, `backend/features/backup/router.ts`, `API.md`.
