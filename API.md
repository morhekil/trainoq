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
| `exercises.library` | query | none | `{ stats: ExerciseStat[], history: Record<string, ExerciseHistoryEntry[]> }` |
| `backup.export` | query | none | `{ exportedAt: string, days: StoredDay[] }` |

Every procedure except `auth.login` and `auth.logout` requires the signed `tq_session` cookie. It is HttpOnly, SameSite=Lax, and lasts one year. HTTPS adds the Secure flag. The server checks the cookie against `APP_PASSWORD`.

`date` and `before` use `YYYY-MM-DD`. `days.list` defaults to 30 days, caps `limit` at 200, and includes every saved day unless `withSessions` is true. `before` is exclusive. `StoredDay` is `{ date: string, doc: DayDoc, updatedAt: string }`. `DayDoc` is defined in `shared/days/model.ts`; the nested session and exercise types live beside their features under `shared/`.

`exercises.library.stats` contains each name's usage count, last date, and counts by section. `history` maps normalized exercise names to up to four recent main-training entries with `{ date, sets: [{ type, weight, reps }] }`. `backup.export` returns the same stored days in ascending date order, plus the export time in ISO format.

## Saving a day

`days.save` sends the **whole** `DayDoc`. The document's `date` must equal the input `date`. The server validates nested fields with Zod and rejects a serialized document longer than 524,288 JavaScript string code units. An empty document deletes that day and its exercise log.

`base` is the `updatedAt` value from the last server copy the client saw. Use `null` if the client has never seen a saved copy. The result is one of:

```ts
type SaveResult =
  | { ok: true; updatedAt: string | null }
  | { ok: false; current: StoredDay | null };
```

On success, retain `updatedAt` as the next `base`; `null` means the day was deleted. On conflict, nothing is written. Show or merge `current`, then save with its `updatedAt` as the new `base` if the user chooses to keep the local document. The browser keeps a local draft and retries synchronization when connectivity returns.

The current D1 revision check and write are separate operations. Simultaneous saves can both pass the check, so `base` is not yet a transactional concurrency guarantee. See `.tasks/20260924T0031-make-day-writes-atomic.md` before adding concurrent clients.

## Errors

tRPC returns `UNAUTHORIZED` for a missing or invalid session or a wrong password. Invalid input, including a malformed nested day, returns `BAD_REQUEST`. Other server failures use the usual tRPC error envelope. The browser wrapper in `frontend/api.ts` turns `UNAUTHORIZED` into `AuthError` and transport failures into `NetworkError`; these wrapper classes are not wire responses. A revision conflict is a successful `days.save` response with `ok: false`.

The API does not yet provide agent-specific credentials or intent-level mutations. Those are tracked in `.tasks/`. Clients that need to write today must send a validated whole-day document through `days.save`.
