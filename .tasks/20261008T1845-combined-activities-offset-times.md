---
title: Combine interval activities and store offset timestamps (DayDoc v9)
status: in-progress
created_at: 2026-10-08T18:45:50+11:00
---

Spec agreed on 8 October 2026 against commit `ad0ac94`.

## Problem

On 2 October, the "Run walk" event holds 13 separate activities from one Garmin recording: 7 walks and 6 runs of about 5 minutes each, 433 cal in total. Effort, minutes and history live on each part. There is no way to record one effort for the whole walk/run, and Run history shows six 5-minute runs.

Visits must keep their parts separate. The 5 October warm-up run, bouldering and strength sessions are an example: each part keeps its own effort and exercise breakdown, and `TrainingEvent` already covers that case.

The fix gives interval activities a separate level. A training event remains a visit with no effort of its own. An activity can hold several segments and has one effort for the whole activity.

Production D1 on 8 October holds 173 v8 days and 5 v7 days. All 47 saved activities have `startedAt`. 46 have `sourceOffsetMinutes`, all Sydney: +600 before 4 October and +660 after. One manual activity has no offset.

## Data model (v9)

```ts
interface DayDoc {
  v: 9;
  date: string;                       // YYYY-MM-DD
  comments: DayComment[];             // unchanged: { id, time: "HH:MM", text }
  events: TrainingEvent[];            // unchanged shape
  garminLinks: GarminLink[];          // NEW; replaces ignoredGarminSourceKeys and every garminSourceKey field
  totalCalories: number | null;
}

type GarminLink = { sourceKey: string; target: { kind: "session" | "segment"; id: string } | null };  // null = ignored

interface TrainingEvent { id; title: string | null; notes: string; entries: EventEntry[]; summaryOverrides? }  // unchanged
type EventEntry = { kind: "session"; session: Session } | { kind: "activity"; activity: Activity };    // unchanged

interface Session {                   // garminSourceKey removed
  id; startedAt: string; endedAt: string | null;   // offset timestamps
  warmup/main/cooldown: SessionItem[]; calories: number | null; notes: string;
}
// SessionItem, StandaloneExercise, Superset, SessionExercise and WorkSet are unchanged.

interface Activity { id: string; comment: string; effort?: Effort; segments: Segment[] }   // 1 or more segments; no exerciseId
interface Segment  { id: string; exerciseId: string; startedAt: string;
                     result: { minutes: number | null; calories: number | null } }
```

These values are calculated, never stored:
- The activity name joins the segments' distinct exercises, in order of first appearance, with "/", for example "Walk/Run" or "Walk".
- Total minutes and calories are the sums over the segments. A total is null only when every segment's value is null.
- The start is the first segment's `startedAt`.

The schema enforces:
- An activity has at least one segment, and segments are ordered by time.
- Every time has the form `YYYY-MM-DDTHH:MM:SS±HH:MM`. A `Z` suffix or a missing offset is rejected.
- Session IDs, activity IDs and segment IDs are each unique within the day, in separate namespaces.
- A link `sourceKey` appears once. Each session or segment has at most one link. Every link target exists in the day.

## Times

- Add helpers in `shared/days/time.ts`: `clockTime(ts)` reads `"HH:MM"` from the string, plus `atClock(date, hhmm, offset)`, `withOffset(utcIso, offset)`, `deviceOffset(date, hhmm)` (correct across daylight saving), `nowLocal()`, and `formatTime(ts)` for `"5:02pm"`.
- Display never converts time zones. The day timeline orders events and comments by clock time. Parts inside an event and segments inside an activity are ordered by instant. Durations use the instant.
- Editing a time replaces `HH:MM` and keeps the date and offset. New entries use the device's offset.
- Remove `frontend/features/sessions/time.ts` (`isoToHHMM` and `hhmmToIso`) and `sourceOffsetMinutes`. Also remove the offset branch in `activityTime` and the `timeZone` parameters on `formatTime`, `sessionLines`, `dayToText`, `daySummary`, `orderedDayEvents` and `orderedDayRecords`.

## Converting v8 to v9

Conversion runs on every read path: D1, local drafts, conflict copies and backups. v7 converts to v8 first. D1 rows become v9 on their next save.

| v8 | v9 |
|---|---|
| activity `a` | `{ id: a.id, comment, effort, segments: [{ id: a.id, exerciseId: a.exerciseId, startedAt, result }] }` |
| `a.startedAt` with `sourceOffsetMinutes` | offset timestamp using Garmin's offset |
| `a.startedAt` without an offset | Sydney offset for that instant |
| no `a.startedAt` (pre-v5 drafts only) | 12:00 that day at the Sydney offset |
| `session.startedAt` and `endedAt` | Sydney offset for that instant |
| `a.garminSourceKey` | link `{ kind: "segment", id: a.id }` |
| `session.garminSourceKey` | link `{ kind: "session", id }` |
| `ignoredGarminSourceKeys[]` | links with `target: null` |

Only this conversion uses `HOME_TIME_ZONE = "Australia/Sydney"`, through `Intl` `longOffset`. Add a `ponytail:` comment explaining that the value suits a single user and that other users would need a zone setting.

## Operations

These are shared code and need tests.
- `combineActivities(day, eventId)` needs at least two parts, all of them activities, and no `summaryOverrides`. It refuses otherwise.
  - It creates a new activity ID and takes every part's segments, ordered by time.
  - Effort becomes the highest part effort.
  - The comment joins the event title, event notes and part comments, skipping empty ones.
  - The event is left with one entry and no title or notes. Links are untouched.
- `splitActivity(day, activityId)` needs at least two segments.
  - Each segment becomes `{ id: segment.id, comment: "", segments: [segment] }` in place of the combined activity.
  - The event title becomes the calculated name, and the event notes become the combined activity's comment.
  - Effort is dropped; undo restores it.
- `removeEventEntry` also deletes the removed item's links.
- Choosing a different exercise for a one-segment activity sets `segments[0].exerciseId`.
- `mergeEvents`, `detachEventEntry` and `addEventEntry` keep their behaviour with the new activity shape.

## Garmin

- `ensurePending`, `ignoreGarmin` and `unlinkGarmin` work on `garminLinks`.
- `acceptActivity` creates one segment and a segment link. The time is Garmin's UTC start with the FIT offset, or the device offset when the FIT has none.
- `linkStrengthSession` adds a session link and still copies calories once.
- `moveLinkedActivity` works only when the linked segment is the activity's only segment; otherwise it fails with "Split the combined activity first". It keeps the clock time and offset and changes only the date.
- `suggestedRecordingGroups`, `eventMeasurements`, review status lookups (`frontend/features/garmin/view.tsx`) and `frontend/features/days/store.ts` read keys through one `linkedKeys` helper.
- The review's "Add all" and "Add as one training event" keep their behaviour. Offering "Add as one activity" in the review is deferred.

## D1 read models and API

- `garmin_links`: a segment link becomes `target_kind: "activity"` with the owning activity's ID, so `garmin.list` output is unchanged.
- `exercise_log` gets one row per activity per distinct exercise. The detail is `{ minutes, calories, effort?, segments?, with? }`, with minutes and calories summed over that exercise's segments. `segments` and `with` are written only when the activity has more than one segment. Plain activity rows stay byte-identical, so existing data needs no backfill.
- `ExerciseHistoryEntry` for activities gains `segments?: number; with?: string[]`. One `activityHistory(activity)` helper serves `logRows`, the backend `historyEntry` and the frontend `localHistory`.
- `putDay` rejects a save from a client older than v9 onto a day stored as v9 with `PRECONDITION_FAILED`. Old clients exist because a service worker caches the app.
- Update `API.md` for the v9 model, `garminLinks`, segments, the time format, the history detail and the version check.

## UI

- A one-segment activity card keeps its current layout. Its name, start time, minutes and calories edit the segment.
- A combined activity card shows the name ("Walk/Run"), a read-only start time, read-only totals ("62 min · 433 cal") and the RPE effort picker.
  - A "13 segments" disclosure lists rows such as "16:24 Walk · 5 min · 21 cal".
  - Its options are "Split into separate activities", "Remove from training event" and "Delete".
- The event card shows "Combine into one activity" when every part is an activity. One tap combines the parts and shows an undo toast; focus moves to the new card.
- On the session card, start and finish inputs use the clock digits and keep the offset. "Finish" uses `nowLocal()`.
- In the Garmin review, a segment of a combined activity shows "Added activity". "Move" is disabled with its reason shown. Times use `clockTime`.
- An exercise history row for a combined activity reads like "6 segments, with Walk", and its effort is labelled as the whole activity's.
- Share text shows `- 16:24 Walk/Run · 62 min · 433 cal · RPE high` followed by `  7× Walk 32 min, 6× Run 30 min`. The day summary uses the calculated name.
- Review copy and layout with `better-interface` and all six owning skills.

## Decisions (8 October)

- History is recorded per segment exercise. Oct 2 adds one Run row and one Walk row, each marked as part of Walk/Run. No combined exercise exists in the catalog.
- Minutes stay whole as imported from Garmin. Oct 2 totals 62 min, and the Garmin timer total (64.3) appears separately.
- When combining, effort takes the highest part effort and comments are joined. Segments have no effort or comment.
- The day timeline still has one level of grouping (events). Combined activities can be parts of a visit.

## Out of scope

- "Add as one activity" in the Garmin review.
- Editing a segment inside a combined activity (split it first).
- Per-segment effort or comments, and event-level effort.
- Events that cross midnight (`20261006T1057-decide-midnight-event-placement`).

## Delivery

Work on the `combined-activities` branch with red/green/refactor and commit after each green state:
1. Offset-time helpers and the Sydney conversion.
2. v9 types, schema and the v8→v9 conversion. Update every reader in the same commit so typecheck stays green.
3. Garmin decisions using links.
4. D1 read models, verified through the Worker API: save and read a v9 day, history rows, Garmin review status, and the old-client check.
5. `combineActivities` and `splitActivity`.
6. UI, one card or screen per cycle.
7. `API.md` and the README, updated alongside each behaviour change.

Capture baseline screenshots before the UI work. Then run `npm run screenshots:check`. Add states for the combined card (collapsed and expanded), the Combine button and a combined history row. Check narrow and desktop widths in both themes. Check keyboard access to Combine, Split and the disclosure, visible focus, and focus after combining or splitting.

Gates: focused tests, `npm run typecheck`, `npm test` and `npm run build`.

After deploying, read Oct 2 and Oct 5 back through the API. Confirm the v9 shape, `+10:00` and `+11:00` times, and the link count. Then combine "Run walk" in the app.

## Progress (8 October)

Built on the `combined-activities` branch: delivery steps 1–7, with gates green (127 unit tests, typecheck, build, 69 screenshot tests). Beyond the spec, the combined card shows its comment (combining moves the event title and notes there) and the Garmin timer and elapsed span from its linked segments, because combining removes the event card that showed them. Splitting a part of a visit keeps the visit's own title and appends the combined comment to its notes.

Remaining: deploy, then read 2 and 5 October back through the API (v9 shape, `+10:00` and `+11:00` times, link count) and combine "Run walk" in the app.
