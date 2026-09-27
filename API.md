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
| `backup.export` | query | none | `{ exportedAt: string, days: StoredDay[], catalog }` |

Every procedure except `auth.login` and `auth.logout` requires the signed `tq_session` cookie. It is HttpOnly, SameSite=Lax, and lasts one year. HTTPS adds the Secure flag. The server checks the cookie against `APP_PASSWORD`.

`date` and `before` use `YYYY-MM-DD`. `days.list` defaults to 30 days, caps `limit` at 200, and includes every saved day unless `withSessions` is true. `before` is exclusive. `StoredDay` is `{ date: string, doc: DayDoc, updatedAt: string }`. `DayDoc` v3 is defined in `shared/days/model.ts`. Each session has ordered `warmup`, `main`, and `cooldown` arrays of `SessionItem`. A standalone item is `{ kind: "exercise", id, exerciseId, comment, sets }`. A superset is `{ kind: "superset", id, members: [{ id, exerciseId, comment }], rounds: [{ id, type }], results: [{ memberId, roundId, weight, reps }] }`. Member and round arrays define display order. Results have exactly one row per member-round pair. A superset remains a superset with zero or one member; an empty superset may retain rounds. `null` means no value, while zero weight means bodyweight.

The catalog owns names, search aliases and section hints. Seed IDs are explicit constants; newly typed custom exercises get UUIDs on the device. `exercises.library.stats` contains usage counts by `exerciseId`, last date and section. `history` maps exercise IDs to up to four recent entries per section with `{ date, section, sets: [{ type, weight, reps }] }`. The Worker maps old log rows and text reps to the same IDs. `backup.export` includes catalog records and stored days in ascending date order. Get, list, and export return v3 even when D1 still holds v1 or v2.

## Saving a day

`days.save` sends the **whole** `DayDoc`. The document's `date` must equal the input `date`. The server validates nested fields, unique member and round IDs, and the complete result-pair grid with Zod; it rejects a serialized document longer than 524,288 JavaScript string code units. Each referenced custom exercise ID must exist in the catalog. Create local custom definitions before saving a day that uses them; the browser does this on reconnect. An empty document deletes that day and its exercise log. The server accepts v1 and v2 days, migrates names and numeric sets without dropping values or comments, and saves v3. Unknown legacy reps text is rejected. An old client receives `PRECONDITION_FAILED` if it tries to save v1 or v2 over an existing v3 day. Existing D1 days convert on read and on their next save; no bulk day rewrite is needed. Unsynced drafts and conflict copies convert locally without changing their revision base or conflict state.

`base` is the `updatedAt` value from the last server copy the client saw. Use `null` if the client has never seen a saved copy. The result is one of:

```ts
type SaveResult =
  | { ok: true; updatedAt: string | null }
  | { ok: false; current: StoredDay | null };
```

On success, retain `updatedAt` as the next `base`; `null` means the day was deleted. On conflict, nothing is written. Show or merge `current`, then save with its `updatedAt` as the new `base` if the user chooses to keep the local document. The browser keeps a local draft and retries synchronization when connectivity returns.

The current D1 revision check and write are separate operations. Simultaneous saves can both pass the check, so `base` is not yet a transactional concurrency guarantee. See `.tasks/20260924T0031-make-day-writes-atomic.md` before adding concurrent clients.

## Errors

tRPC returns `UNAUTHORIZED` for a missing or invalid session or a wrong password. Invalid input, including a malformed day or unresolved exercise ID, returns `BAD_REQUEST`. An old client write over v3 returns `PRECONDITION_FAILED`. Other server failures use the usual tRPC error envelope. The browser wrapper in `frontend/api.ts` turns `UNAUTHORIZED` into `AuthError` and transport failures into `NetworkError`; these wrapper classes are not wire responses. A revision conflict is a successful `days.save` response with `ok: false`.

The API does not yet provide agent-specific credentials or intent-level mutations. Those are tracked in `.tasks/`. Pure session edit rules in `shared/sessions/ops.ts` can be reused by those future mutations. Clients that need to write today must send a validated whole-day document through `days.save`.
