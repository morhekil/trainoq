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
| `exercises.library` | query | none | `{ catalog, stats: ExerciseStat[], history: Record<string, ExerciseHistoryEntry[]> }` |
| `garmin.import` | mutation | `{ activities: GarminActivitySummary[] }` | `{ inserted, unchanged, updated, rejected }` counts |
| `garmin.list` | query | `{ from: string, to: string }` | Imported summaries with `importedAt`, `status`, `targetId`, `decisionDate` |
| `garmin.connection` | query | none | Connection status, email, last sync time and error, next backfill offset |
| `garmin.connect` | mutation | `{ email: string, password: string }` | `{ status: "connected" \| "mfa" }` |
| `garmin.verifyMfa` | mutation | `{ code: string }` | `{ status: "connected" }` |
| `garmin.disconnect` | mutation | none | `{ status: "disconnected" }` |
| `garmin.sync` | mutation | none | One 20-ID page with counts, `nextOffset`, and `complete` |
| `backup.export` | query | none | `{ exportedAt: string, days: StoredDay[], catalog, garminActivities }` |

Every procedure except `auth.login` and `auth.logout` requires the signed `tq_session` cookie. It is HttpOnly, SameSite=Lax, and lasts one year. HTTPS adds the Secure flag. The server checks the cookie against `APP_PASSWORD`.

`date` and `before` use `YYYY-MM-DD`. `days.list` defaults to 30 days, caps `limit` at 200, and includes every saved day unless `withSessions` is true. `before` is exclusive.

The browser parses original FIT files with `shared/garmin/fit.ts` and sends summaries to `garmin.import` in batches of at most 100 and 256 KiB. Each session needs FIT total and metabolic calories; active calories are their difference, verified against Garmin Connect for the sampled run, walk, tennis, and strength recordings. A missing or inconsistent source field rejects that session. The API validates each summary and counts rejected records. Re-importing the same summary is unchanged; a changed summary updates the source row and leaves saved day edits alone. `garmin.list` includes records in the inclusive local date range, falling back to the UTC date when FIT has no local offset. `status` is `pending`, `activity`, `session`, or `ignored`. A decision is stored through `days.save`, with the usual revision conflict flow.

The recurring Garmin connection stores its account password and tokens in an AES-GCM encrypted record. The key is derived from the Worker's `APP_PASSWORD` secret. Changing that secret makes the connection appear disconnected until Garmin is connected again with the new key. The connection record is excluded from `backup.export`.
The connected client reads Garmin's activity list and original activity exports over HTTPS. It accepts FIT files directly or extracts FIT entries from a Garmin ZIP, with a 64 MiB export limit. It never writes to the Garmin account. These private Garmin endpoints can change independently of Trainoq.
Each sync page reads up to 20 Garmin activity IDs. The Worker parses their original FIT sessions through the same `shared/garmin/fit.ts` parser as the browser, imports the summaries, and records the Garmin activity IDs it completed. It refreshes an expired access token and stores its replacement. If Garmin rejects the refresh token, it signs in again with the encrypted stored password; a new MFA challenge pauses sync until the code is entered. An invalid FIT or unavailable original export is counted as rejected and retried on a later scan without stopping other activities. Rate limits and server errors stop the page so it can be retried. The next page cursor and a short sync lease live in D1. A repeat scan skips completed IDs and keeps Trainoq day edits separate from source data.
The Worker runs one sync page every five minutes while connected. The authenticated `garmin.sync` mutation runs a page on demand and supports a faster initial backfill from the browser.
Sync failures update `lastError` on the connection. A rate limit leaves the connection eligible for the next scheduled retry. Rejected credentials or a Garmin browser challenge set status `error` and stop scheduled attempts until the account is connected again.
The Garmin screen submits credentials through the authenticated API, clears the password field, and starts backfill after a successful sign-in. It shows a verification-code form only if Garmin requests one. Completing MFA keeps the backfill cursor. `Sync all now` pages until Garmin has no more IDs; leaving the page does not erase the D1 cursor, and the Worker schedule continues later. Disconnecting deletes the encrypted connection but leaves imported summaries and day decisions intact.

Accepting a Garmin record as an activity copies its start time, source UTC offset when present, timer duration rounded to minutes, and active calories into a new editable activity. The offset preserves the Garmin time of day when reviewing a trip from another time zone. Linking a strength recording to a completed session keeps its exercises, sets, time, notes, and any already entered calories; otherwise it fills active calories once. Strength suggestions require the same source local date and a completed session starting within an hour. Multiple matches need an explicit choice. Ignoring stores the source key on the day. Unlinking or restoring removes the decision key while leaving the Trainoq item and its edits intact.

Moving a linked activity to a corrected date preserves its ID, exercise, notes, duration, calories and displayed local time. Both day drafts are stored locally first, then the old day syncs before the new one so the unique source link moves in order. If either sync fails, the drafts remain available through the normal sync retry and conflict controls. The saved source offset remains the original FIT offset; edit the start time if the corrected date has another UTC offset.

## Data model

The saved document is `DayDoc` v5. These shapes are a map for readers; the current types live in [`shared/days/model.ts`](shared/days/model.ts), [`shared/sessions/model.ts`](shared/sessions/model.ts), and [`shared/exercises/model.ts`](shared/exercises/model.ts).

```ts
type SetType = "warmup" | "working" | "backoff";
type SetValues = { weight: number | null; reps: number | null };
type WorkSet = SetValues & { id: string; type: SetType };
type ActivityResult = { minutes: number | null; calories: number | null };

interface Exercise { id: string; name: string } // catalog definition
interface PerformedExercise { id: string; exerciseId: string; comment: string }
type StandaloneExercise = PerformedExercise & { kind: "exercise"; sets: WorkSet[] };
interface Superset {
  kind: "superset";
  id: string;
  members: PerformedExercise[];
  rounds: { id: string; type: SetType }[];
  results: (SetValues & { memberId: string; roundId: string })[];
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
interface DayDoc {
  v: 5;
  date: string; // YYYY-MM-DD
  morning: string;
  sessions: Session[];
  activities: Activity[];
  ignoredGarminSourceKeys: string[];
  totalCalories: number | null;
  notes: string;
}
```

`Activity` is a performed exercise outside a training session. It uses the same catalog ID and comment as a session performance, with minutes and calories in `result`. Session calories, activity calories, and the manually entered daily `totalCalories` are separate fields. `Section` locates an item within a session; `ExerciseContext` also includes activities. `SetType` describes a set or superset round independently of its section. A catalog `Exercise.id` identifies the exercise name, while each `PerformedExercise.id` identifies one occurrence. Built-in definitions come from [`shared/exercises/seed.ts`](shared/exercises/seed.ts); custom definitions use UUIDs created on the device and are stored in `exercise_catalog`. The same exercise can be chosen in a session or as an activity.

A standalone item owns its ordered `sets`. A superset owns ordered `members` and `rounds`, with one `results` row for every `(memberId, roundId)` pair. For two members and three rounds, there are six results. Validation rejects duplicate member or round IDs, unknown or repeated result pairs, and missing pairs. The explicit `kind` keeps a superset a superset with zero or one member; an empty superset can retain rounds. `null` is an unentered weight or rep count, and weight `0` means bodyweight. See [`shared/days/schema.ts`](shared/days/schema.ts) for validation and [`shared/sessions/ops.ts`](shared/sessions/ops.ts) for shared editing operations.

There is no `Block` in v5. V2 used `{ id, exercises: [...] }` blocks in all three session sections; v1 used them in `main` and individual legacy items in `warmup` and `cooldown`. [`shared/days/migrate.ts`](shared/days/migrate.ts) converts v1/v2 session data and v1/v2/v3 name-based activities. Old activity `notes` become the performance `comment`; minutes and calories keep their values. The UI still uses `block` as a CSS class. Get, list, and export return v5 even when an untouched D1 row contains an older version; saving writes v5.

### Storage and read models

| Store | Contents | Role |
| --- | --- | --- |
| D1 `days` | `date`, full `DayDoc` JSON, server `updated_at` | Source of truth, one row per saved day |
| D1 `exercise_catalog` | Custom exercise `id`, `name`, normalized `name_key` | Definitions referenced by `exerciseId` |
| D1 `exercise_log` | One row per session performance or activity, with date, context, ID, name, order, and set or activity result detail | Derived index rebuilt from the day on each save |
| D1 `garmin_activities` | Imported summary JSON, hash, and import time keyed by Garmin source identity | Imported source values |
| D1 `garmin_links` | Garmin source key, decision day, target kind and ID | Derived index rebuilt from the day on each save |
| D1 `garmin_connection` | AES-GCM encrypted Garmin account credentials and tokens, sync status and cursor | Recurring import connection, excluded from backup |
| D1 `garmin_downloads` | Garmin activity IDs whose original FITs were imported | Skip completed downloads on later sweeps |
| Browser `tq:day:<date>` | `Entry { doc, base, dirty, rev, conflict? }` | Local draft, sync revision, and optional conflict copy |

The table definitions are in [`migrations/0001_init.sql`](migrations/0001_init.sql), [`migrations/0002_exercise_catalog.sql`](migrations/0002_exercise_catalog.sql), and [`migrations/0004_garmin.sql`](migrations/0004_garmin.sql) through [`migrations/0006_garmin_sync.sql`](migrations/0006_garmin_sync.sql). [`migrations/0003_activity_catalog.sql`](migrations/0003_activity_catalog.sql) adds old activities to the catalog and log without rewriting day JSON. [`backend/features/days/db.ts`](backend/features/days/db.ts) rebuilds `exercise_log` and `garmin_links` in the same revision-checked batch; the full day JSON retains the superset structure and Garmin decisions. The browser's [`store.ts`](frontend/features/days/store.ts) writes drafts locally first and syncs whole days. Custom definitions sync before a day that references them.

`exercises.library` returns the read model defined in [`shared/exercises/model.ts`](shared/exercises/model.ts):

```ts
interface ExerciseStat {
  exerciseId: string;
  count: number;
  last: string;
  sections: Partial<Record<ExerciseContext, number>>;
}
type ExerciseHistoryEntry =
  | { date: string; section: Section; sets: Pick<WorkSet, "type" | "weight" | "reps">[] }
  | { date: string; section: "activity"; result: ActivityResult };
interface ExerciseLibrary {
  catalog: (Exercise & { section: ExerciseContext | "any" | null; aliases: string })[];
  stats: ExerciseStat[];
  history: Record<string, ExerciseHistoryEntry[]>;
}
```

History is keyed by exercise ID; the Worker returns up to four recent entries per context. Activities contribute to recent usage and have minutes and calories in history. `backup.export` includes catalog records, imported Garmin summaries, and stored days in ascending date order. `StoredDay` is `{ date, doc: DayDoc, updatedAt }`.

## Saving a day

`days.save` sends the **whole** `DayDoc`. The document's `date` must equal the input `date`. The server validates nested fields, unique member and round IDs, and the complete result-pair grid with Zod; it rejects a serialized document longer than 524,288 JavaScript string code units. Each referenced custom exercise ID, including an activity's, must exist in the catalog. Create local custom definitions before saving a day that uses them; the browser does this on reconnect. An empty document deletes that day and its exercise log. The server accepts v1 through v4 days, migrates names and results without dropping values or comments, and saves v5. Unknown legacy reps text is rejected. An old client receives `PRECONDITION_FAILED` if it tries to save an older version over an existing v5 day. Existing D1 days convert on read and on their next save; no bulk day rewrite is needed. Unsynced drafts and conflict copies convert locally without changing their revision base or conflict state. A v5 day can hold optional Garmin source keys on sessions and activities, an optional activity start time, and ignored Garmin source keys. An ignored decision keeps an otherwise empty day stored.

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

tRPC returns `UNAUTHORIZED` for a missing or invalid session or a wrong password. Invalid input, including a malformed day or unresolved exercise ID, returns `BAD_REQUEST`. An old client write over v5 returns `PRECONDITION_FAILED`. Other server failures use the usual tRPC error envelope. The browser wrapper in `frontend/api.ts` turns `UNAUTHORIZED` into `AuthError` and transport failures into `NetworkError`; these wrapper classes are not wire responses. A revision conflict is a successful `days.save` response with `ok: false`.

The API does not yet provide agent-specific credentials or intent-level mutations. Those are tracked in `.tasks/`. Pure session edit rules in `shared/sessions/ops.ts` can be reused by those future mutations. Clients that need to write today must send a validated whole-day document through `days.save`.
