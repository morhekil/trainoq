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
| `exercises.library` | query | none | `{ catalog, stats: ExerciseStat[], history: Record<string, ExerciseHistoryEntry[]>, params: Record<string, ParamSet> }` |
| `exercises.setParams` | mutation | `{ exerciseId: string, params: ParamSet, updatedAt: ISO string }` | Stored `{ exerciseId, params, updatedAt }`; newer `updatedAt` wins |
| `exercises.history` | query | `{ exerciseId: string }` | Up to 200 entries, newest first; seed IDs include old name-based rows |
| `garmin.list` | query | `{ from: string, to: string, includeLinked?: boolean, cursor?: { importedAt: string, sourceKey: string } }` | `{ items, nextCursor }`, up to 20 imported summaries per page |
| `garmin.summaries` | query | `{ sourceKeys: string[] }`, 1 to 100 FIT session keys | Imported summaries for those keys; missing keys are omitted |
| `garmin.connection` | query | none | Connection status, email, last sync time and error, next backfill offset |
| `garmin.connect` | mutation | `{ email: string, password: string }` | `{ status: "connected" \| "mfa" }` |
| `garmin.verifyMfa` | mutation | `{ code: string }` | `{ status: "connected" }` |
| `garmin.disconnect` | mutation | none | `{ status: "disconnected" }` |
| `garmin.sync` | mutation | none | One 20-ID page with counts, `nextOffset`, and `complete` |
| `backup.export` | query | none | `{ exportedAt: string, days: StoredDay[], catalog, garminActivities, exerciseParams }` |

Every procedure except `auth.login` and `auth.logout` requires the signed `tq_session` cookie. It is HttpOnly, SameSite=Lax, and lasts one year. HTTPS adds the Secure flag. The server checks the cookie against `APP_PASSWORD`.

`date` and `before` use `YYYY-MM-DD`. `days.list` defaults to 30 days, caps `limit` at 200, and includes every saved day unless `withSessions` is true. `before` is exclusive.

The Worker parses original FIT files from Garmin with `shared/garmin/fit.ts`. Each session needs FIT total and metabolic calories; active calories are their difference, verified against Garmin Connect for the sampled run, walk, tennis, and strength recordings. A missing or inconsistent source field rejects that session. The Worker validates each summary and counts rejected records. Re-importing the same summary is unchanged; a changed summary updates the source row and leaves saved day edits alone. `garmin.list` includes records in the inclusive local date range, falling back to the UTC date when FIT has no local offset. It defaults to pending records; `includeLinked: true` also returns linked and ignored records. Pages are ordered by import time, newest first, with source key as the tie breaker. Pass `nextCursor` as the next query's `cursor` until it is `null`. Each item includes `importedAt`, `status`, `targetId`, and `decisionDate`; `status` is `pending`, `activity`, `session`, or `ignored`. A decision is stored through `days.save`, with the usual revision conflict flow.

The recurring Garmin connection stores its account password and tokens in an AES-GCM encrypted record. The key is derived from the Worker's `APP_PASSWORD` secret. Changing that secret makes the connection appear disconnected until Garmin is connected again with the new key. The connection record is excluded from `backup.export`.
The connected client reads Garmin's activity list and original activity exports over HTTPS. It accepts FIT files directly or extracts FIT entries from a Garmin ZIP, with a 64 MiB export limit. It never writes to the Garmin account. These private Garmin endpoints can change independently of Trainoq.
Each sync page reads up to 20 Garmin activity IDs that started on or after the UTC date 10 days before the sync. Older activities are never listed. The Worker parses their original FIT sessions, imports the summaries, and records the Garmin activity IDs it completed. It refreshes an expired access token and stores its replacement. If Garmin rejects the refresh token, it signs in again with the encrypted stored password; a new MFA challenge pauses sync until the code is entered. An invalid FIT or unavailable original export is counted as rejected and retried on a later scan without stopping other activities. Rate limits and server errors stop the page so it can be retried. The next page cursor and a short sync lease live in D1. A repeat scan skips completed IDs and keeps Trainoq day edits separate from source data.
The Worker runs one sync page every five minutes while connected. The authenticated `garmin.sync` mutation runs a page on demand and supports a faster initial backfill from the browser.
Sync failures update `lastError` on the connection. A rate limit leaves the connection eligible for the next scheduled retry. Rejected credentials or a Garmin browser challenge set status `error` and stop scheduled attempts until the account is connected again.
The Garmin screen submits credentials through the authenticated API, clears the password field, and starts backfill after a successful sign-in. It shows a verification-code form only if Garmin requests one. Completing MFA keeps the backfill cursor. `Sync all now` pages until Garmin has no more IDs; leaving the page does not erase the D1 cursor, and the Worker schedule continues later. The review initially shows pending recordings and loads 20 at a time. `Show all` includes linked and ignored recordings. A newly decided recording stays visible until the page is refreshed, the date range changes, or the view is toggled. Disconnecting deletes the encrypted connection but leaves imported summaries and day decisions intact.

Accepting a Garmin record as an activity copies its start time, source UTC offset when present, timer duration rounded to minutes, and active calories into a new editable activity. The offset preserves the Garmin time of day when reviewing a trip from another time zone. Linking a strength recording to a completed session keeps its exercises, sets, time, notes, and any already entered calories; otherwise it fills active calories once. Strength suggestions require the same source local date and a completed session starting within an hour. Multiple matches need an explicit choice. Ignoring stores the source key on the day. Unlinking or restoring removes the decision key while leaving the Trainoq item and its edits intact.

The source key ends with the FIT session's message index. Removing that final index identifies summaries from one FIT recording for grouping suggestions; each child retains its full source key.
Grouped events with parts from one FIT show saved, rounded part minutes separately from the raw Garmin timer sum and elapsed span. The displayed Garmin active calorie sum comes from imported source fields; it does not set the day-wide manual `totalCalories`. Mixed events do not derive a calorie sum from overlapping session and activity measurements. `garmin.summaries` supplies the source fields to the day view; an offline day still retains its saved parts and values.

Moving a linked activity to a corrected date preserves its ID, exercise, notes, duration, calories and displayed local time. Both day drafts are stored locally first, then the old day syncs before the new one so the unique source link moves in order. If either sync fails, the drafts remain available through the normal sync retry and conflict controls. The saved source offset remains the original FIT offset; edit the start time if the corrected date has another UTC offset.

## Data model

The saved document is `DayDoc` v8. These shapes are a map for readers; the current types live in [`shared/days/model.ts`](shared/days/model.ts), [`shared/sessions/model.ts`](shared/sessions/model.ts), [`shared/exercises/model.ts`](shared/exercises/model.ts), and [`shared/exercises/params.ts`](shared/exercises/params.ts).

```ts
type SetType = "warmup" | "working" | "backoff";
type Param = "height" | "edge" | "distance" | "weight" | "time" | "reps" | "angle";
type ParamSet = { perSet: Param[]; setup?: Param[] };
type ParamValues = Partial<Record<Param, number | null>>;
type WorkSet = ParamValues & { id: string; type: SetType };
type ActivityResult = { minutes: number | null; calories: number | null };

interface Exercise { id: string; name: string } // catalog definition
interface PerformedExercise { id: string; exerciseId: string; comment: string }
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
  startedAt: string; // ISO timestamp
  endedAt: string | null;
  warmup: SessionItem[];
  main: SessionItem[];
  cooldown: SessionItem[];
  calories: number | null;
  notes: string;
  garminSourceKey?: string;
}
type Activity = PerformedExercise & { result: ActivityResult; startedAt?: string; sourceOffsetMinutes?: number; garminSourceKey?: string };
interface DayComment { id: string; time: string; text: string }
type EventEntry = { kind: "session"; session: Session } | { kind: "activity"; activity: Activity };
interface TrainingEvent {
  id: string;
  title: string | null;
  notes: string;
  entries: EventEntry[]; // at least one
  summaryOverrides?: { elapsedSeconds?: number | null; timerSeconds?: number | null; activeCalories?: number | null };
}
interface DayDoc {
  v: 8;
  date: string; // YYYY-MM-DD
  comments: DayComment[]; // local HH:mm on this date
  events: TrainingEvent[];
  ignoredGarminSourceKeys: string[];
  totalCalories: number | null;
}
```

Parameter keys have one canonical order. `height` is box height in inches (step 2); `edge` is millimetres (step 5); `distance` is metres (step 100); `weight` is kilograms (step 2.5, with 0 meaning bodyweight); `time` is seconds (step 5); and `reps` is a count (step 1). These six are per set. `angle` is bench angle in degrees (step 5) and belongs once per entry in `setup`. A parameter set has one to three per-set keys and at most two setup keys, without repeats or keys in the wrong scope. Writers send `null` for empty selected values; readers accept a missing selected key as empty. `paramsName()` derives display names from the keys, so template names are not saved in day records.

Each saved session or activity belongs to exactly one event. A lone item has a singleton event; grouping items changes their event membership while retaining their IDs and edits. Entries in a combined event are ordered by start time. Separating a part creates a new singleton and keeps the grouped event's note. Combining refuses event-level totals or secondary titles and notes that would otherwise be lost. Pending Garmin summaries remain outside the day document. `Activity` uses the catalog ID and comment of a session performance, with minutes and calories in `result`. Session calories, activity calories, and the manually entered daily `totalCalories` are separate fields. `Section` locates an item within a session; `ExerciseContext` also includes activities. `SetType` describes a set or superset round independently of its section. A catalog `Exercise.id` identifies the exercise name, while each `PerformedExercise.id` identifies one occurrence. Built-in definitions come from [`shared/exercises/seed.ts`](shared/exercises/seed.ts); custom definitions use UUIDs created on the device and are stored in `exercise_catalog`. The same exercise can be chosen in a session or as an activity.

Each `DayComment.time` is a local 24-hour `HH:mm` time on the document's date. The day view and shared text order comments, sessions, and activities by their displayed local start time. Activities without a start time follow timed records. Editing a comment's time moves it within the timeline.

A standalone item owns its ordered `sets`. A superset owns ordered `members` and `rounds`, with one `results` row for every `(memberId, roundId)` pair. For two members and three rounds, there are six results. Each session record copies its parameter set; older records keep their own set when exercise defaults change. Validation rejects duplicate member or round IDs, unknown or repeated result pairs, missing pairs, parameters outside registry order, and values outside a record's chosen parameters. Each set has one to three parameters. `setup` holds at most two once-per-entry parameters. `null` is an unentered value, and weight `0` means bodyweight. See [`shared/days/schema.ts`](shared/days/schema.ts) for validation and [`shared/sessions/ops.ts`](shared/sessions/ops.ts) for shared editing operations.

There is no `Block` in v8. V2 used `{ id, exercises: [...] }` blocks in all three session sections; v1 used them in `main` and individual legacy items in `warmup` and `cooldown`. [`shared/days/migrate.ts`](shared/days/migrate.ts) converts v1/v2 session data and v1/v2/v3 name-based activities. Old activity `notes` become the performance `comment`; minutes and calories keep their values. V1 through v5 day-level `morning` and `notes` become comments at 08:00 and 23:30 when no more specific audit applies. V6 sessions and activities become singleton events with stable IDs derived from the original item IDs. V7 session records receive weight × reps parameters without changing their values. Get, list, and export return v8 even when an untouched D1 row contains an older version; saving writes v8. An older client cannot overwrite a stored v8 day.

### Storage and read models

| Store | Contents | Role |
| --- | --- | --- |
| D1 `days` | `date`, full `DayDoc` JSON, server `updated_at` | Source of truth, one row per saved day |
| D1 `exercise_catalog` | Custom exercise `id`, `name`, normalized `name_key` | Definitions referenced by `exerciseId` |
| D1 `exercise_params` | Exercise ID, parameter-set JSON, ISO update time | Default parameters for new records; newer writes win |
| D1 `exercise_log` | One row per session performance or activity, with date, context, ID, name, order, and detail including session `params`, optional `setup`, and sets | Derived index rebuilt from the day on each save |
| D1 `garmin_activities` | Imported summary JSON, hash, and import time keyed by Garmin source identity | Imported source values |
| D1 `garmin_links` | Garmin source key, decision day, target kind and ID | Derived index rebuilt from the day on each save |
| Browser `tq:params` | Pending per-exercise parameter sets and update times | Saved before network requests; retried independently of day drafts |
| D1 `garmin_connection` | AES-GCM encrypted Garmin account credentials and tokens, sync status and cursor | Recurring import connection, excluded from backup |
| D1 `garmin_downloads` | Garmin activity IDs whose original FITs were imported | Skip completed downloads on later sweeps |
| Browser `tq:day:<date>` | `Entry { doc, base, dirty, rev, conflict? }` | Local draft, sync revision, and optional conflict copy |

The table definitions are in [`migrations/0001_init.sql`](migrations/0001_init.sql) through [`migrations/0007_exercise_params.sql`](migrations/0007_exercise_params.sql). [`migrations/0003_activity_catalog.sql`](migrations/0003_activity_catalog.sql) adds old activities to the catalog and log without rewriting day JSON. [`backend/features/days/db.ts`](backend/features/days/db.ts) rebuilds `exercise_log` and `garmin_links` in the same revision-checked batch; the full day JSON retains the superset structure and Garmin decisions. Session log rows written before v8 have no parameters and read as weight × reps. The browser's [`store.ts`](frontend/features/days/store.ts) writes drafts locally first and syncs whole days. Parameter changes save to `tq:params` first and sync through `exercises.setParams` independently of day saves. Custom definitions sync before a day or parameter change that references them.

`exercises.library` returns the read model defined in [`shared/exercises/model.ts`](shared/exercises/model.ts):

```ts
interface ExerciseStat {
  exerciseId: string;
  count: number;
  last: string;
  sections: Partial<Record<ExerciseContext, number>>;
}
type ExerciseHistoryEntry =
  | { date: string; section: Section; params: ParamSet; setup?: ParamValues; sets: (Pick<WorkSet, "type"> & ParamValues)[] }
  | { date: string; section: "activity"; result: ActivityResult };
interface ExerciseLibrary {
  catalog: (Exercise & { section: ExerciseContext | "any" | null; aliases: string })[];
  stats: ExerciseStat[];
  history: Record<string, ExerciseHistoryEntry[]>;
  params: Record<string, ParamSet>;
}
```

History is keyed by exercise ID; the Worker returns up to four recent entries per context. Activities contribute to recent usage and have minutes and calories in history. `backup.export` includes catalog records, imported Garmin summaries, and stored days in ascending date order. `StoredDay` is `{ date, doc: DayDoc, updatedAt }`.

## Saving a day

`days.save` sends the **whole** `DayDoc`. The document's `date` must equal the input `date`. The server validates nested fields, nonempty event entries, unique event, entry and comment IDs, member and round IDs, the complete result-pair grid, and parameter values with Zod; it rejects a serialized document longer than 524,288 JavaScript string code units. Each referenced custom exercise ID, including an activity's, must exist in the catalog. Create local custom definitions before saving a day that uses them; the browser does this on reconnect. An empty document deletes that day and its exercise log. The server accepts v1 through v7 days, migrates names, results and day notes without dropping values, and saves v8. Unknown legacy reps text is rejected. An old client receives `PRECONDITION_FAILED` if it tries to save an older version over an existing v8 day. Existing D1 days convert on read and on their next save. Unsynced drafts and conflict copies convert locally without changing their revision base or conflict state. Sessions and activities can hold optional Garmin source keys, activities can hold an optional start time, and ignored Garmin source keys stay at day level. An ignored decision or comment keeps an otherwise empty day stored.

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

tRPC returns `UNAUTHORIZED` for a missing or invalid session or a wrong password. Invalid input, including a malformed day or unresolved exercise ID, returns `BAD_REQUEST`. An old client write over v8 returns `PRECONDITION_FAILED`. Other server failures use the usual tRPC error envelope. The browser wrapper in `frontend/api.ts` turns `UNAUTHORIZED` into `AuthError` and transport failures into `NetworkError`; these wrapper classes are not wire responses. A revision conflict is a successful `days.save` response with `ok: false`.

The API does not yet provide agent-specific credentials or intent-level mutations. Those are tracked in `.tasks/`. Pure session edit rules in `shared/sessions/ops.ts` can be reused by those future mutations. Clients that need to write today must send a validated whole-day document through `days.save`.
