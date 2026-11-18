# Trainoq API

The browser and other clients use the same tRPC v11 API at `/api/trpc`. `backend/router.ts` composes the procedures below. Each feature router owns its input validation and implementation; `shared/days/schema.ts` validates a complete `DayDoc`. The exported `AppRouter` type is the TypeScript contract. The browser imports that type only, with no backend code in its bundle.

Use `createTRPCClient<AppRouter>` from `@trpc/client` with `httpLink({ url: "https://<host>/api/trpc" })`. The browser client in `frontend/api.ts` sends same-origin cookies. A separate TypeScript client must retain the `Set-Cookie` value from `auth.login` and send it with later requests. Queries use GET and mutations use POST through the tRPC HTTP link.

From a signed-in browser:

```ts
import { createTRPCClient, httpLink } from "@trpc/client";
import type { AppRouter } from "./backend/router";

const api = createTRPCClient<AppRouter>({
  links: [httpLink({ url: "/api/trpc" })],
});
const day = await api.days.get.query("2026-09-26");
```

## Procedures

Withings source measurements use `WeightMeasurement`: `{ sourceId, userId, groupId, measuredAt, timezone, localDate, weightKg }`. `measuredAt` is UTC; `localDate` uses the Withings account timezone. A source ID includes the account and measurement group IDs, so repeat imports update the same reading and multiple weigh-ins remain distinct. Weight is converted from Withings' integer and decimal exponent to kilograms. Only actual measurements (category 1, type 1) are imported. Provider responses are validated before storage.

Provider contracts: [OAuth tokens](https://developer.withings.com/api-reference/#operation/oauth2-requesttoken), [measurements](https://developer.withings.com/api-reference/#operation/measure-getmeas). Update timestamps accept integer JSON values and the numeric strings documented by Withings; invalid timestamps stop the page before storage or checkpoint advancement.

### Withings

Register an app in the [Withings developer dashboard](https://developer.withings.com/dashboard/) with `https://<your-trainoq-host>/api/withings/callback` as its callback URL. Set `WITHINGS_CLIENT_ID` and `WITHINGS_CLIENT_SECRET` using `npx wrangler secret put <name>`; for local development put them in `.dev.vars` and register the local origin's callback too. Apply migration `0011_withings.sql` before running the updated Worker. Withings remains optional; Garmin and training continue without these secrets. Open **Menu → Withings weight → Connect Withings** to authorize measurement access. First sync imports history one page at a time; the five-minute schedule continues it automatically. **Sync now** fetches the next page immediately. Reconnect if authorization has expired. Disconnect stops Trainoq polling and removes local tokens; remove Trainoq's access in Withings too if you want to revoke provider-side consent.

All Withings procedures require the Trainoq session cookie. Tokens and OAuth state are excluded from backups and API responses.

The **Withings weight** screen lists readings newest first and offers **Load more** for older readings. Each timestamp links to its source-local training day. A read-only **Body weight** card on that day shows all its imported readings without modifying its document. These source views require a network connection; training drafts keep their existing offline behavior.

| Procedure | Kind | Input | Result |
| --- | --- | --- | --- |
| `withings.connection` | query | none | `{ configured, connected, userId, lastSyncAt, lastError, historyComplete }` |
| `withings.authorize` | mutation | none | `{ url }` for Withings consent; sets a ten-minute HttpOnly state cookie |
| `withings.sync` | mutation | none | `{ imported, complete }` for one provider page; repeat until complete to finish history |
| `withings.measurements` | query | `{ from?, to?, limit?: 1..200, cursor?: { measuredAt, sourceId } }` | `{ items: WeightMeasurement[], nextCursor }`, newest first, filtered by inclusive source-local dates |
| `withings.disconnect` | mutation | none | `{ ok: true }`; removes local tokens and pending authorization, keeps imported readings |

Withings redirects to `GET /api/withings/callback`. The Worker checks the Trainoq session and browser-bound state, atomically consumes the expiring state, exchanges the code, encrypts tokens with AES-GCM using an `APP_PASSWORD`-derived key, and redirects to `/#/withings`. Failed or cancelled authorization redirects to `/#/withings?error=authorization` and preserves any existing connection. Changing `APP_PASSWORD` requires reconnecting Withings.

The existing five-minute schedule polls each connected provider independently, so a Garmin failure does not prevent a Withings poll. Withings imports all available weight history one page per run, then requests changes using `lastupdate`. Pagination keeps its original filter until the sweep completes; the next sweep overlaps the oldest provider update timestamp by one second. Each page atomically upserts its readings and checkpoint. A five-minute lease serializes token refresh, scheduled and manual sync, reconnection and disconnect. Rotated tokens are stored before use; rejected access tokens are refreshed once. Failure leaves the page cursor intact and exposes a safe, retryable error. Imported source records stay outside `DayDoc`, so imports never overwrite offline drafts or change day revisions. `backup.export.withingsMeasurements` contains all imported readings in chronological order. Provider-side deletions are not propagated; backups retain readings already imported.

| Procedure | Kind | Input | Result |
| --- | --- | --- | --- |
| `auth.login` | mutation | `{ password: string }` | `{ ok: true }`; sets a session cookie |
| `auth.me` | query | none | `{ ok: true }` if signed in |
| `auth.logout` | mutation | none | `{ ok: true }`; clears the cookie |
| `days.get` | query | `date: string` | `{ date, doc: DayDoc \| null, updatedAt: string \| null }` |
| `days.list` | query | `{ before?: string, limit?: number, withSessions?: boolean }` | `StoredDay[]`, newest date first |
| `days.save` | mutation | `{ date: string, doc: DayDoc, base: string \| null }` | `SaveResult` below |
| `exercises.catalog` | query | none | catalog records with `id`, `name`, `section`, `aliases` |
| `exercises.create` | mutation | `{ id: UUID, name: string }` | custom `{ id, name }`; legacy `legacy:<normalized name>` IDs are accepted for migration |
| `exercises.library` | query | none | `{ catalog, stats: ExerciseStat[], history: Record<string, ExerciseHistoryEntry[]>, params: Record<string, ParamSet>, templates: ParamTemplate[] }` |
| `exercises.setParams` | mutation | `{ exerciseId: string, params: ParamSet, updatedAt: ISO string }` | Stored `{ exerciseId, params, updatedAt }`; newer `updatedAt` wins |
| `exercises.history` | query | `{ exerciseId: string }` | Up to 200 entries, newest first; seed IDs include old name-based rows |
| `exercises.saveTemplate` | mutation | `{ id: UUID, name: string (1–60 characters), params: ParamSet }` | Saved template; insert or update by ID |
| `exercises.deleteTemplate` | mutation | `{ id: UUID }` | Deletes a template; a missing ID is accepted |
| `garmin.list` | query | `{ from: string, to: string, includeLinked?: boolean, cursor?: { importedAt: string, sourceKey: string } }` | `{ items, nextCursor }`, up to 20 imported summaries per page |
| `garmin.summaries` | query | `{ sourceKeys: string[] }`, 1 to 100 FIT session keys | Imported summaries for those keys; missing keys are omitted |
| `garmin.connection` | query | none | Connection status, email, last sync time and error, next backfill offset |
| `garmin.connect` | mutation | `{ email: string, password: string }` | `{ status: "connected" \| "mfa" }` |
| `garmin.verifyMfa` | mutation | `{ code: string }` | `{ status: "connected" }` |
| `garmin.disconnect` | mutation | none | `{ status: "disconnected" }` |
| `garmin.sync` | mutation | none | Imports one 20-ID page, then auto-imports pending recordings; returns the page counts, `nextOffset`, and `complete` |
| `backup.export` | query | none | `{ exportedAt: string, days: StoredDay[], catalog, garminActivities, exerciseParams, paramTemplates }` |

Every procedure except `auth.login` and `auth.logout` requires the signed `tq_session` cookie. It is HttpOnly, SameSite=Lax, and lasts one year. HTTPS adds the Secure flag. The server checks the cookie against `APP_PASSWORD`.

`date` and `before` use `YYYY-MM-DD`. `days.list` defaults to 30 days, caps `limit` at 200, and includes every saved day unless `withSessions` is true. `before` is exclusive.

The Worker parses original FIT files from Garmin with `shared/garmin/fit.ts`. Each session needs FIT total and metabolic calories; active calories are their difference, verified against Garmin Connect for the sampled run, walk, tennis, and strength recordings. A missing or inconsistent source field rejects that session. The Worker validates each summary and counts rejected records. Re-importing the same summary is unchanged; a changed summary updates the source row and leaves saved day edits alone. `garmin.list` includes records in the inclusive local date range, falling back to the UTC date when FIT has no local offset. It defaults to pending records; `includeLinked: true` also returns linked and ignored records. Pages are ordered by import time, newest first, with source key as the tie breaker. Pass `nextCursor` as the next query's `cursor` until it is `null`. Each item includes `importedAt`, `status`, `targetId`, and `decisionDate`; `status` is `pending`, `activity`, `session`, or `ignored`. A decision is stored through `days.save`, with the usual revision conflict flow.

The recurring Garmin connection stores its account password and tokens in an AES-GCM encrypted record. The key is derived from the Worker's `APP_PASSWORD` secret. Changing that secret makes the connection appear disconnected until Garmin is connected again with the new key. The connection record is excluded from `backup.export`.
The connected client reads Garmin's activity list, original activity exports, profile display name, and daily summaries over HTTPS. It accepts FIT files directly or extracts FIT entries from a Garmin ZIP, with a 64 MiB export limit. It never writes to the Garmin account. These private Garmin endpoints can change independently of Trainoq.
Each sync page reads up to 20 Garmin activity IDs that started on or after the UTC date 10 days before the sync. Older activities are never listed. The Worker parses their original FIT sessions, imports the summaries, and records the Garmin activity IDs it completed. It refreshes an expired access token and stores its replacement. If Garmin rejects the refresh token, it signs in again with the encrypted stored password; a new MFA challenge pauses sync until the code is entered. An invalid FIT or unavailable original export is counted as rejected and retried on a later scan without stopping other activities. Rate limits and server errors stop the page so it can be retried. The next page cursor and a short sync lease live in D1. A repeat scan skips completed IDs and keeps Trainoq day edits separate from source data.
Each sync page also reads Garmin's daily summary (`usersummary-service/usersummary/daily`, with the display name from `userprofile-service/socialProfile`) for the last 7 UTC dates, at most once every 30 minutes per date. A day is finished when its summary ends at the next local midnight. For a finished day, the Worker saves `activeKilocalories` as the day's `totalCalories` through `putDay` and its usual revision check, creating the day if needed. It writes only when `totalCalories` is empty or still equals the value Garmin last wrote, which D1 keeps in `garmin_daily`. Any other value was typed and is kept. A day that has not ended is never written, so the browser's edits and offline drafts of today do not meet a Worker revision. Garmin's figure is rechecked until a fetch 12 hours after the day ends, then the date is settled and not requested again. If a browser save wins the revision race, the date is retried on the next sync. The `garmin.sync` result is unchanged.
The Worker runs one sync page every five minutes while connected. The authenticated `garmin.sync` mutation runs a page on demand and supports a faster initial backfill from the browser.
After every scheduled run and every `garmin.sync` page, the Worker auto-imports pending recordings whose FIT local date falls within the last 10 UTC days, one day at a time, with `autoImport` in [`shared/garmin/decisions.ts`](shared/garmin/decisions.ts). A strength recording links to its only matching session, which takes the recording's times as described below. Any other recording becomes an activity whose exercise is the built-in or catalog exercise named like the FIT title, or a new custom exercise with that name; the parts of one FIT become one training event. Strength with no matching session or several, and recordings without a FIT offset, stay pending for review. Each day is saved through `putDay` with its revision check, so a day a browser save just changed is retried on the next run, and a browser holding unsynced edits to that day receives the usual conflict. `garmin_activities.auto_imported_at` marks each auto-imported recording, so one you later unlink or delete stays pending and is never imported again.
Sync failures update `lastError` on the connection. A rate limit leaves the connection eligible for the next scheduled retry. Rejected credentials or a Garmin browser challenge set status `error` and stop scheduled attempts until the account is connected again.
The Garmin screen submits credentials through the authenticated API, clears the password field, and starts backfill after a successful sign-in. It shows a verification-code form only if Garmin requests one. Completing MFA keeps the backfill cursor. `Sync all now` pages until Garmin has no more IDs; leaving the page does not erase the D1 cursor, and the Worker schedule continues later. The review initially shows pending recordings and loads 20 at a time. `Show all` includes linked and ignored recordings. A newly decided recording stays visible until the page is refreshed, the date range changes, or the view is toggled. Disconnecting deletes the encrypted connection but leaves imported summaries and day decisions intact.

Accepting a Garmin record as an activity creates a one-segment activity and a segment link. The segment copies the start time with the FIT's UTC offset, or the device's offset when the FIT has none, the timer duration rounded to minutes, and active calories. The offset keeps the Garmin time of day when reviewing a trip from another time zone. Linking a strength recording to a session, finished or still running, adds a session link and keeps its exercises, sets, notes, and any already entered calories; otherwise it fills active calories once. The watch timed the workout, so the session takes the recording's start, and its finish becomes that start plus the FIT elapsed time, or the timer time when elapsed is missing, both at the session's own UTC offset. This closes a session left running and corrects a finish entered late. Unlinking keeps the corrected times. Strength suggestions require the same source local date and an unlinked session starting within an hour. Multiple matches need an explicit choice. Ignoring adds a link with `target: null`. Unlinking or restoring removes the link while leaving the Trainoq item and its edits intact. Deleting a session or activity deletes its links.

The source key ends with the FIT session's message index. Removing that final index identifies summaries from one FIT recording for grouping suggestions; each child retains its full source key.
Grouped events with parts from one FIT show saved, rounded part minutes separately from the raw Garmin timer sum and elapsed span. The displayed Garmin active calorie sum comes from imported source fields; it does not set the day-wide manual `totalCalories`. Mixed events do not derive a calorie sum from overlapping session and activity measurements. A combined activity whose segments all link to one FIT shows the same source timer sum, elapsed span and active calories beside its saved whole-minute totals, so the 2 Oct walk/run reads 62 min saved and a 64.3 min Garmin timer. `garmin.summaries` supplies the source fields to the day view; an offline day still retains its saved parts and values.

Moving a linked activity to a corrected date preserves its ID, exercise, notes, duration, calories, clock time and offset; only the date changes. Its link moves with it. A segment of a combined activity cannot move on its own; the move fails with "Split the combined activity first". Both day drafts are stored locally first, then the old day syncs before the new one so the unique source link moves in order. If either sync fails, the drafts remain available through the normal sync retry and conflict controls. Edit the start time if the corrected date has another UTC offset.

## Data model

The saved document is `DayDoc` v9. These shapes are a map for readers; the current types live in [`shared/days/model.ts`](shared/days/model.ts), [`shared/sessions/model.ts`](shared/sessions/model.ts), [`shared/exercises/model.ts`](shared/exercises/model.ts), and [`shared/exercises/params.ts`](shared/exercises/params.ts).

```ts
type SetType = "warmup" | "working" | "backoff";
type Param = "height" | "edge" | "band" | "distance" | "weight" | "time" | "reps" | "angle";
type ParamSet = { perSet: Param[]; setup?: Param[] };
type ParamValues = Partial<Record<Param, number | null>>;
type WorkSet = ParamValues & { id: string; type: SetType };
type ActivityResult = { minutes: number | null; calories: number | null };

interface Exercise { id: string; name: string } // catalog definition
type Effort = "low" | "med" | "high" | "max"; // RPE scale
interface PerformedExercise { id: string; exerciseId: string; comment: string; effort?: Effort }
type SessionExercise = PerformedExercise & { params: ParamSet; setup?: ParamValues };
type StandaloneExercise = SessionExercise & { kind: "exercise"; sets: WorkSet[] };
interface Superset {
  kind: "superset";
  id: string;
  members: SessionExercise[];
  rounds: { id: string; type: SetType }[];
  results: (ParamValues & { memberId: string; roundId: string })[];
}
type SessionItem = StandaloneExercise | Superset;
type Section = "warmup" | "main" | "cooldown";
type ExerciseContext = Section | "activity";

interface Session {
  id: string;
  startedAt: string; // "YYYY-MM-DDTHH:MM:SS±HH:MM"
  endedAt: string | null;
  warmup: SessionItem[];
  main: SessionItem[];
  cooldown: SessionItem[];
  calories: number | null;
  notes: string;
}
interface Segment { id: string; exerciseId: string; startedAt: string; result: ActivityResult }
interface Activity { id: string; comment: string; effort?: Effort; segments: Segment[] } // at least one segment, ordered by time
interface DayComment { id: string; time: string; text: string; score?: { metric: string; value: number } } // value: whole number 0–5
type EventEntry = { kind: "session"; session: Session } | { kind: "activity"; activity: Activity };
interface TrainingEvent {
  id: string;
  title: string | null;
  notes: string;
  entries: EventEntry[]; // at least one
  summaryOverrides?: { elapsedSeconds?: number | null; timerSeconds?: number | null; activeCalories?: number | null };
}
type GarminLink = { sourceKey: string; target: { kind: "session" | "segment"; id: string } | null }; // null = ignored
interface DayDoc {
  v: 9;
  date: string; // YYYY-MM-DD
  comments: DayComment[]; // local HH:mm on this date
  events: TrainingEvent[];
  garminLinks: GarminLink[];
  totalCalories: number | null;
}
```

Parameter keys have one canonical order. `height` is box height in inches (step 2); `edge` is millimetres (step 5); `band` is band assistance as a whole number from 0 (no band) to 5 (most assistance); `distance` is metres (step 100); `weight` is kilograms (step 2.5, with 0 meaning bodyweight); `time` is seconds (step 5); and `reps` is a count (step 1). These seven are per set. `angle` is bench angle in degrees (step 5) and belongs once per entry in `setup`. A parameter set has one to three per-set keys and at most two setup keys, without repeats or keys in the wrong scope. Writers send `null` for empty selected values; readers accept a missing selected key as empty. `paramsName()` derives display names from the keys, so template names are not saved in day records.

Each saved session or activity belongs to exactly one event. A lone item has a singleton event; grouping items changes their event membership while retaining their IDs and edits. Entries in a combined event are ordered by start instant. Separating a part creates a new singleton and keeps the grouped event's note. Combining refuses event-level totals or secondary titles and notes that would otherwise be lost.

`combineActivities` in [`shared/days/model.ts`](shared/days/model.ts) turns an event whose two or more parts are all activities, with no entered totals, into one activity in a new ID. It takes every part's segments in time order and the highest part effort. Its comment joins the event title, event notes and part comments on separate lines, skipping empty ones; the event is left with that one activity and no title or notes. `splitActivity` reverses it for an activity with two or more segments: each segment becomes an activity with the segment's ID and an empty comment, in place of the combined one. The event keeps its own title or takes the calculated name, and the combined comment is appended to its notes; the effort is dropped. Segment IDs never change, so Garmin links survive both operations. Pending Garmin summaries remain outside the day document. An `Activity` has a comment, one optional effort, and one or more segments. Each segment has its own catalog exercise ID, start time, minutes and calories. The activity's name, totals and start are calculated, never stored: the name joins the segments' distinct exercises in order of first appearance with "/" ("Walk/Run", or "Walk" for one exercise); minutes and calories are sums over the segments and are `null` only when every segment's value is `null`; the start is the first segment's `startedAt`. Session calories, activity calories, and the manually entered daily `totalCalories` are separate fields. `Section` locates an item within a session; `ExerciseContext` also includes activities. `SetType` describes a set or superset round independently of its section. A catalog `Exercise.id` identifies the exercise name, while each `PerformedExercise.id` identifies one occurrence. Built-in definitions come from [`shared/exercises/seed.ts`](shared/exercises/seed.ts); custom definitions use UUIDs created on the device and are stored in `exercise_catalog`. The same exercise can be chosen in a session or as an activity.

`effort` records how hard one exercise entry, superset member, or activity was, once per entry. It uses the RPE scale. Records whose parameters include `reps` display it as reps in reserve: `low` is "a lot", `med` is "many", `high` is "few", and `max` is "none". Changing parameters relabels the stored value without converting it. A missing `effort` means none was recorded.

Session and segment times have the form `YYYY-MM-DDTHH:MM:SS±HH:MM`: the clock time where they were recorded and that place's UTC offset. A `Z` suffix, fractional seconds or a missing offset is rejected. Display reads the clock digits and never converts time zones. Each `DayComment.time` is a local 24-hour `HH:mm` time on the document's date. The day view and shared text order comments and events by clock time; parts inside an event and segments inside an activity are ordered by instant, and durations use the instant. Editing a start or segment time replaces `HH:MM` and keeps the date and offset. Editing a session finish time uses the first matching clock time at or after its start, with the stored finish offset. New sessions, activities and comments use the device's offset. Editing a comment's time moves it within the timeline. A comment can carry one score for a tracked metric, such as `{ metric: "Back", value: 2 }`: 0 means no issues and 5 the worst. Its text may be empty. The metric is a name, not a catalog ID, so a temporary metric needs no setup; names with different capitalisation count as one metric.

`garminLinks` holds every Garmin decision for the day: a link to a session, a link to one segment of an activity, or `target: null` for an ignored recording. A source key appears once, each session or segment has at most one link, and every target exists in the day. Session IDs, activity IDs and segment IDs are each unique within the day, in separate namespaces.

A standalone item owns its ordered `sets`. A superset owns ordered `members` and `rounds`, with one `results` row for every `(memberId, roundId)` pair. For two members and three rounds, there are six results. Each session record copies its parameter set; older records keep their own set when exercise defaults change. Validation rejects duplicate member or round IDs, unknown or repeated result pairs, missing pairs, parameters outside registry order, and values outside a record's chosen parameters. Each set has one to three parameters. `setup` holds at most two once-per-entry parameters. `null` is an unentered value, and weight `0` means bodyweight. See [`shared/days/schema.ts`](shared/days/schema.ts) for validation and [`shared/sessions/ops.ts`](shared/sessions/ops.ts) for shared editing operations.

There is no `Block` in v9. V2 used `{ id, exercises: [...] }` blocks in all three session sections; v1 used them in `main` and individual legacy items in `warmup` and `cooldown`. [`shared/days/migrate.ts`](shared/days/migrate.ts) converts v1/v2 session data and v1/v2/v3 name-based activities. Old activity `notes` become the performance `comment`; minutes and calories keep their values. V1 through v5 day-level `morning` and `notes` become comments at 08:00 and 23:30 when no more specific audit applies. V6 sessions and activities become singleton events with stable IDs derived from the original item IDs. V7 session records receive weight × reps parameters without changing their values. V8 activities become one-segment activities whose segment keeps the activity's ID, exercise and result; their source keys, session source keys and ignored keys become `garminLinks`. V8 saved UTC instants: an activity time with a Garmin offset is rewritten at that offset, and every other time at the `Australia/Sydney` offset in force at that instant. A pre-v5 activity without a start time gets 12:00 at the Sydney offset that day. This conversion runs on every read path: D1, local drafts, conflict copies and backups. Get, list, and export return v9 even when an untouched D1 row contains an older version; saving writes v9. A client cannot overwrite a stored v8 or later day with an older version.

On 7 Oct 2026, the eight existing days with session records were converted to record-specific v8 parameters using [`scripts/migrate_exercise_records.py`](scripts/migrate_exercise_records.py). This one-time conversion kept their original comments and set identities, and rebuilt `exercise_log` from each converted day. Activity-only v7 rows still normalize on read.

PT history from the Coach Pro export (September 2022 to September 2026) is transcribed by hand into the line format described in [`scripts/import_pt_history.py`](scripts/import_pt_history.py), which maps every note to canonical exercises and parameters and keeps the raw note as the session's notes. [`scripts/import_pt_history.ts`](scripts/import_pt_history.ts) sends the result through `exercises.create`, `exercises.setParams` and `days.save`, so the Worker validates each day and rebuilds `exercise_log` as it does for browser saves. Re-running skips days already holding the same document; any other existing day is reported, not overwritten. The 24 Sep 2026 PT work joins the start of that day's logged session. Note dates are the session dates; a note written between midnight and 06:00 belongs to the previous day.

### Storage and read models

| Store | Contents | Role |
| --- | --- | --- |
| D1 `days` | `date`, full `DayDoc` JSON, server `updated_at` | Source of truth, one row per saved day |
| D1 `exercise_catalog` | Custom exercise `id`, `name`, normalized `name_key` | Definitions referenced by `exerciseId` |
| D1 `exercise_params` | Exercise ID, parameter-set JSON, ISO update time | Default parameters for new records; newer writes win |
| D1 `param_templates` | UUID, user name, parameter-set JSON | Reusable choices; recorded days do not reference templates |
| D1 `exercise_log` | One row per session performance or per distinct exercise of an activity, with date, context, ID, name, order, and detail: session `params`, optional `setup` and sets, or activity `{ minutes, calories, effort?, segments?, with? }` | Derived index rebuilt from the day on each save |
| D1 `garmin_activities` | Imported summary JSON, hash, import time, and auto-import time keyed by Garmin source identity | Imported source values |
| D1 `garmin_links` | Garmin source key, decision day, target kind and ID; a segment link is stored as kind `activity` with the owning activity's ID | Derived index rebuilt from the day on each save |
| Browser `tq:params` | Pending per-exercise parameter sets and update times | Saved before network requests; retried independently of day drafts |
| Browser `tq:param-templates` | Pending template saves and deleted IDs | Saved before network requests; retried independently of day drafts |
| D1 `garmin_connection` | AES-GCM encrypted Garmin account credentials and tokens, sync status and cursor | Recurring import connection, excluded from backup |
| D1 `garmin_downloads` | Garmin activity IDs whose original FITs were imported | Skip completed downloads on later sweeps |
| Browser `tq:day:<date>` | `Entry { doc, base, dirty, rev, conflict? }` | Local draft, sync revision, and optional conflict copy |

The table definitions are in [`migrations/0001_init.sql`](migrations/0001_init.sql) through [`migrations/0008_param_templates.sql`](migrations/0008_param_templates.sql). [`migrations/0003_activity_catalog.sql`](migrations/0003_activity_catalog.sql) adds old activities to the catalog and log without rewriting day JSON. [`backend/features/days/db.ts`](backend/features/days/db.ts) rebuilds `exercise_log` and `garmin_links` in the same revision-checked batch; the full day JSON retains the superset structure and Garmin decisions. Session log rows written before v8 have no parameters and read as weight × reps. The browser's [`store.ts`](frontend/features/days/store.ts) writes drafts locally first and syncs whole days. Parameter changes save to `tq:params` first and sync through `exercises.setParams` independently of day saves. Template saves and deletions use `tq:param-templates` and retry through their own procedures. Custom definitions sync before a day or parameter change that references them.

`exercises.library` returns the read model defined in [`shared/exercises/model.ts`](shared/exercises/model.ts):

```ts
interface ExerciseStat {
  exerciseId: string;
  count: number;
  last: string;
  sections: Partial<Record<ExerciseContext, number>>;
}
type ExerciseHistoryEntry =
  | { date: string; section: Section; params: ParamSet; setup?: ParamValues; sets: (Pick<WorkSet, "type"> & ParamValues)[]; effort?: Effort }
  | { date: string; section: "activity"; result: ActivityResult; effort?: Effort; segments?: number; with?: string[] };
interface ExerciseLibrary {
  catalog: (Exercise & { section: ExerciseContext | "any" | null; aliases: string })[];
  stats: ExerciseStat[];
  history: Record<string, ExerciseHistoryEntry[]>;
  params: Record<string, ParamSet>;
  templates: ParamTemplate[];
}
interface ParamTemplate { id: string; name: string; params: ParamSet }
```

History is keyed by exercise ID; the Worker returns up to four recent entries per context. Activities contribute to recent usage and have minutes and calories in history. An activity adds one history entry per distinct exercise, with minutes and calories summed over that exercise's segments and the activity's effort. When the activity has more than one segment, the entry also has `segments`, the count of that exercise's segments, and `with`, the IDs of the activity's other exercises; a 2 Oct walk/run gives a Run entry and a Walk entry, each marked as part of the combined activity. A one-segment activity's entry and log row are unchanged from v8. Templates are sorted by name. They do not change records or exercise defaults when edited or deleted. `backup.export` includes catalog records, imported Garmin summaries, parameter defaults, templates, and stored days in ascending date order. `StoredDay` is `{ date, doc: DayDoc, updatedAt }`.

## Saving a day

`days.save` sends the **whole** `DayDoc`. The document's `date` must equal the input `date`. The server validates nested fields, the time format, nonempty event entries, activities with at least one segment in time order, unique event, comment, member and round IDs, unique session, activity and segment IDs, Garmin links, the complete result-pair grid, and parameter values with Zod; it rejects a serialized document longer than 524,288 JavaScript string code units. Each referenced custom exercise ID, including an activity's, must exist in the catalog. Create local custom definitions before saving a day that uses them; the browser does this on reconnect. An empty document deletes that day and its exercise log. The server accepts v1 through v8 days, migrates names, results and day notes without dropping values, and saves v9. Unknown legacy reps text is rejected. A client receives `PRECONDITION_FAILED` if it saves an older version over an existing v8 or later day. A service worker can keep an old app running, so a v8 client cannot replace a v9 day. Existing D1 days convert on read and on their next save. Unsynced drafts and conflict copies convert locally without changing their revision base or conflict state. Garmin decisions stay at day level in `garminLinks`. An ignored decision or comment keeps an otherwise empty day stored.

A Garmin source key can have one decision across all days. A duplicate link or ignore returns `BAD_REQUEST` and leaves the attempted day and derived indexes untouched.

`base` is the `updatedAt` value from the last server copy the client saw. Use `null` if the client has never seen a saved copy. The result is one of:

```ts
type SaveResult =
  | { ok: true; updatedAt: string | null }
  | { ok: false; current: StoredDay | null };
```

On success, retain `updatedAt` as the next `base`; `null` means the day was deleted. On conflict, nothing is written. Show or merge `current`, then save with its `updatedAt` as the new `base` if the user chooses to keep the local document. The browser keeps a local draft and retries synchronization when connectivity returns.

The revision comparison, day write and exercise-index update run in one D1 batch. Concurrent saves from the same `base` leave one winner; the loser receives the current day without changing the index. Treat `updatedAt` as an opaque, unique revision token, even though its column retains the old name.

## Errors

tRPC returns `UNAUTHORIZED` for a missing or invalid session or a wrong password. Invalid input, including a malformed day or unresolved exercise ID, returns `BAD_REQUEST`. A write of an older version over a stored v8 or later day returns `PRECONDITION_FAILED`. Other server failures use the usual tRPC error envelope. The browser wrapper in `frontend/api.ts` turns `UNAUTHORIZED` into `AuthError` and transport failures into `NetworkError`; these wrapper classes are not wire responses. A revision conflict is a successful `days.save` response with `ok: false`.

The API does not yet provide agent-specific credentials or intent-level mutations. Those are tracked in `.tasks/`. Pure session edit rules in `shared/sessions/ops.ts` can be reused by those future mutations. Clients that need to write today must send a validated whole-day document through `days.save`.
