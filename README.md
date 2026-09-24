# Trainoq

Mobile-first training log: morning check-in, sessions with warm-up / main / cool-down, supersets, set-by-set weights, calories, and a one-tap text summary to send to your PT or physio.

Runs on Cloudflare: a Worker serves the app and a tRPC API, data lives in D1.

## What it does (v1)

- **Day view**, defaults to today. Arrows or tap the date to move around; "Today" jumps back.
- **Morning check-in** – free text.
- **Start training session** – records the start time; "Finish" records the end. Both editable.
- **Warm-up / cool-down** – exercise + reps (free text, so `30s` or `2x10` work) + comment.
- **Main** – single exercises or supersets (A, B1/B2/B3…). Each set has a type:
  - `W1 W2` warm-up (dashed), `1 2 3` working (solid), `B1` back-off (tinted). Tap the label to change type.
  - **+ Set / + Round → Warm-up | Working | Back-off.** A new set copies the last set of that type; the first working or back-off set starts from what you did last session. Correct with the ± buttons (2.5 kg / 1 rep) or type.
  - Every exercise in a superset has the same sets. A round adds one set to each exercise, changing a set's type changes it for the whole round, and ✕ removes the whole round (with Undo). An exercise added to a superset gets the same set types as the others. Weights and reps stay per exercise.
  - ✕ on a single exercise removes one set (with Undo).
  - "Last Tue 22 Sep: …" under each exercise shows the previous session.
- **Exercise search** – full-screen picker: recent first, starter list, search by name or alias (`rdl`, `ohp`). If it's not there, "Use "…"" saves what you typed and it shows up in search from then on.
- **Repeat** – an empty section offers "Repeat <last date>" to copy the last session's warm-up, main structure (no sets) or cool-down.
- **Calories** – per session, per extra activity (walk etc.), and a daily total.
- **Share day with PT / physio** – plain-text summary via the phone share sheet (WhatsApp, SMS, email) or copy.
- **Works with no signal** – every change is saved on the phone first and synced in the background. If the same day was edited on two devices you choose which version to keep.
- **Installable** – "Add to Home Screen" gives a full-screen app that opens offline.
- **Backup** – menu → Download backup (JSON of every day).

## Run locally

```sh
npm install
npm run setup:local      # creates .dev.vars (password: change-me) and the local database
npm run dev              # http://localhost:5173
```

Local password is whatever `APP_PASSWORD` is in `.dev.vars`.

## Deploy to Cloudflare

First time:

```sh
npx wrangler login
npm run deploy                       # Wrangler offers to create the "trainoq" D1 database – say yes
npx wrangler secret put APP_PASSWORD # pick a long password; this is the only thing protecting your data
```

Open the `*.workers.dev` URL it prints, sign in (the cookie lasts a year), then Share → Add to Home Screen.

After that, `npm run deploy` builds, deploys and applies any new migrations.

Custom domain: Workers & Pages → trainoq → Settings → Domains & Routes, or add a `routes` entry to `wrangler.jsonc`.

## Layout

```
shared/     data model, share-text formatter, starter exercise list (seed-exercises.ts)
worker/     API: auth.ts (password → signed cookie), db.ts (D1 queries), router.ts (tRPC), index.ts (adapter)
src/        React app
  lib/      api.ts (typed tRPC client), store.ts (local-first sync), library.ts (exercise search/history), ops.ts (edits)
  components/
migrations/ D1 schema
tests/      unit tests (npm test)
```

### Data model

One JSON document per day (`days` table) is the source of truth. On every save the worker rebuilds `exercise_log` – one row per exercise per day – which powers search, "last time" hints and, later, progress charts. Types are in `shared/types.ts`.

### API seam

All app data traffic goes through `/api/trpc`. The browser imports only the `AppRouter` type from `worker/router.ts`; the Worker owns auth, validation, D1 access, and write conflicts. A TypeScript agent client can use the same router type and tRPC HTTP client. Call `auth.login` with the password, retain the returned cookie, then use the other procedures.

| Feature | Procedure | Contract |
| --- | --- | --- |
| Sign in, session check, sign out | `auth.login`, `auth.me`, `auth.logout` | Signed cookie; all data procedures require it |
| Day view and history | `days.get`, `days.list` | Day documents and server `updatedAt` |
| Morning, sessions, sets, activities, calories, notes, repeat | `days.save` | Complete validated `DayDoc` plus `base`; returns the current copy on conflict |
| Exercise search and last-time hints | `exercises.library` | Usage stats and recent main sets; client adds the shared starter catalog and unsynced local entries |
| Download backup | `backup.export` | All days and export timestamp; browser turns the result into a JSON file |

The browser keeps its local draft for offline use and syncs it with `days.save`. The shared document schema is the transport boundary. UI edit helpers, formatting, and search ranking remain client-side; another client can read and write the same document without reproducing the UI. The next seam, when agent workflows need intent-level operations, is to move selected edits into shared pure functions and expose narrow mutations through this router. Keep the day document and revision check as the common persistence contract until then.

Before simultaneous clients are active, make the D1 revision check and write atomic: `putDay` currently reads the revision before its write batch, so two concurrent saves can both pass the check. Then add agent credentials and intent-level procedures for the concrete agent workflows, using the same router rather than another transport.

## Next

- Garmin: pull daily and activity calories instead of typing them.
- Read-only share links for PT / physio (per-person token, pick a date range).
- Progress view per exercise (top working set over time) from `exercise_log`.
- Planning: build a session ahead of time and tick sets off at the gym.
