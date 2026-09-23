# Trainoq

Mobile-first training log: morning check-in, sessions with warm-up / main / cool-down, supersets, set-by-set weights, calories, and a one-tap text summary to send to your PT or physio.

Runs on Cloudflare: a Worker serves the app and a small JSON API, data lives in D1.

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
worker/     API: auth.ts (password → signed cookie), db.ts (D1 queries), index.ts (routes)
src/        React app
  lib/      store.ts (local-first sync), library.ts (exercise search/history), ops.ts (edits)
  components/
migrations/ D1 schema
tests/      formatter tests (npm test)
```

### Data model

One JSON document per day (`days` table) is the source of truth. On every save the worker rebuilds `exercise_log` – one row per exercise per day – which powers search, "last time" hints and, later, progress charts. Types are in `shared/types.ts`.

### API

All routes except login require the session cookie.

| Method | Path | |
| --- | --- | --- |
| POST | `/api/login` | `{password}` → sets cookie |
| POST | `/api/logout` | |
| GET | `/api/days/:date` | `{date, doc, updatedAt}` (`doc: null` if nothing logged) |
| PUT | `/api/days/:date` | `{doc, base}` – `base` is the `updatedAt` you last saw; 409 + current copy if it changed since |
| GET | `/api/days?before=&limit=&sessions=1` | recent days, newest first |
| GET | `/api/exercises` | usage stats + last 4 main-training entries per exercise |
| GET | `/api/export` | everything as JSON |

## Next

- Garmin: pull daily and activity calories instead of typing them.
- Read-only share links for PT / physio (per-person token, pick a date range).
- Progress view per exercise (top working set over time) from `exercise_log`.
- Planning: build a session ahead of time and tick sets off at the gym.
