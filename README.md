# Trainoq

Mobile-first training log: timed day comments, sessions with warm-up / main / cool-down, supersets, set-by-set weights, calories, and a one-tap text summary to send to your PT or physio.

Runs on Cloudflare: a Worker serves the app and a tRPC API, data lives in D1.

## What it does

- **Day view**, defaults to today. Arrows or tap the date to move around; "Today" jumps back. Training events and day comments appear in start-time order. An event with several parts appears as one expandable card; its original sessions and activities remain editable inside. New manual activities use the current local time on the selected day. Older records without a start time appear after timed records; set their time to place them in the day.
- **Keyboard date navigation** – the date picker shows its focus position, even though the native date input sits over the displayed date.
- **Day comments** – notes with an editable local time appear beside sessions and activities in time order. Add, edit, delete, or undo them at any time. History previews the earliest nonempty comment. Older morning and day notes convert to timed comments.
- **Training events** – use a session or activity's options to add it to another event on the same day. Expand a grouped event to name it, add a note, edit its parts, or separate one part again. Grouping and separation retain the original item IDs and Garmin links. History and shared day text show the visit as one event while shared text lists its parts.
- **Multi-part FIT recordings** – preview pending parts from one recording in Garmin review and add them as a single event, or group saved parts from the day suggestion. Each part keeps its original source link and editable values; parts from a different recording stay separate.
- **Event measurements** – a grouped FIT event labels its saved rounded part minutes, Garmin timer sum, elapsed span, and Garmin source active calories separately. Source measurements load from imported summaries; saved parts remain editable offline.
- **Daily active calories** – remains a separate manual value. When a training event combines a session and an activity, the day hides the sum of part calories because those measurements may overlap.
- **Start training session** – records the start time; "Finish" records the end. Both editable.
- **Warm-up / main / cool-down** – each section supports single exercises and supersets (A, B1/B2/B3…). Every exercise has a comment and numeric weight and reps for each set. Set type is independent of section:
  - `W1 W2` warm-up (dashed), `1 2 3` working (solid), `B1` back-off (tinted). Tap the label to change type.
  - **+ Set** on a standalone exercise and **+ Round** on a superset add the last type, or warm-up when empty. A new superset round copies each exercise's weight and reps from the final round; the first round starts empty. Correct values with the ± buttons (2.5 kg / 1 rep) or type. Tap the set label to cycle its type.
  - Supersets keep their identity even with zero or one member. Create an empty superset with **+ Superset**, or drag an existing exercise onto it to create a one-member superset. Add members through the picker or drag another standalone exercise onto the labelled superset target. If set types differ, review the alignment preview before appending rounds. Drag a round handle to reorder it without changing its recorded values.
  - Use the exercise or superset options sheet to delete sets, rounds, exercises or a whole superset with Undo. **Dissolve superset** converts members into standalone exercises with their comments and values intact. Taking out or deleting a member leaves the superset in place.
  - "Last Tue 22 Sep: …" under each exercise shows its previous entry in the same section.
- **Exercise search** – full-screen picker for session exercises and other activities: recent first, starter list, search by name or alias (`rdl`, `ohp`). If it's not there, "Use "…"" saves what you typed and it shows up in search from then on. Run, Walk, Tennis, Yoga, and Skipping use the same catalog.
- **Repeat** – an empty section offers "Repeat <last date>" to copy exercise references, superset grouping, and set types. Recorded weight and reps are cleared.
- **Calories** – per session, per extra activity (walk etc.), and a daily total.
- **Narrow screens** – activity name and numeric fields use two compact rows when a single row would hide the name.
- **Share day with PT / physio** – plain-text summary in timeline order via the phone share sheet (WhatsApp, SMS, email) or copy.
- **Copy feedback** – the copy result stays visible in the share sheet until it closes.
- **Undo and errors** – each Undo action and error message stays visible until used or dismissed. Undoing an earlier deletion also clears later Undo actions because their snapshots no longer match the restored day.
- **Keyboard overlays** – action sheets, exercise search, and sharing keep focus inside while open. Escape closes them and returns focus to the button that opened them.
- **Reduced motion** – session indicators and overlays stay readable without animation when the device requests reduced motion.
- **Works with no signal** – every change is saved on the phone first and synced in the background. If the same day was edited on two devices, compare both versions and confirm which one replaces the other.
- **Sync retry** – when saving fails or the device is offline, the status badge has a keyboard-accessible retry action.
- **Installable** – "Add to Home Screen" gives a full-screen app that opens offline.
- **Backup** – menu → Download backup (JSON of every day, the exercise catalog, and imported Garmin summaries).
- **Garmin activities** – menu → Garmin activities. Sign in with your Garmin email and password to import original FIT recordings from the last 10 days and sync new ones every five minutes. Older Garmin history is not imported. If Garmin asks for a verification code, enter it in the second step. If Garmin later rejects the stored credentials, the connection screen explains the failure and accepts replacement credentials. The password and access tokens are encrypted in D1; disconnecting removes them while imported summaries remain. The review shows pending recordings first, ordered by import time with the newest on top; Load more fetches another 20, and Show all includes previously linked and ignored recordings. A recording you decide on stays in view until you refresh or change the filters. Review the FIT start time, timer duration and active calories before adding an activity, linking a strength recording to a completed session, or ignoring it. Edit the proposed date and activity name before accepting. Imported source values stay separate from Trainoq edits. Unlink, restore, or move an accepted activity to another date in the review screen; edit its name, start time, duration and calories on its day. The backup includes imported summaries.

## Run locally

```sh
npm install
npm run setup:local      # creates .dev.vars (password: change-me) and the local database
npm run dev              # http://localhost:5173
```

Local password is whatever `APP_PASSWORD` is in `.dev.vars`.

## Frontend screenshots

`npm run screenshots:check` compares login, full-page day, exercise picker, menu, share, history, and Garmin review screens at narrow and desktop widths in light and dark themes against the checked-in images in `visual/*-snapshots/`. The test uses Chrome, a fixed Sydney time zone and locale, and mocked tRPC responses, so it does not change your D1 database. Install Google Chrome before running it.

Run `npm run screenshots:baseline` only after reviewing an intentional visual change. It updates the reference images; inspect the changed PNGs before committing them.

## Deploy to Cloudflare

First time:

```sh
npx wrangler login
npm run deploy                       # Wrangler offers to create the "trainoq" D1 database – say yes
npx wrangler secret put APP_PASSWORD # pick a long password; this is the only thing protecting your data
```

Open the `*.workers.dev` URL it prints, sign in (the cookie lasts a year), then Share → Add to Home Screen.

After that, `npm run deploy` builds, applies any new migrations, then deploys.

Custom domain: Workers & Pages → trainoq → Settings → Domains & Routes, or add a `routes` entry to `wrangler.jsonc`.

## Layout

```
frontend/              React app and its typed API client
  features/             auth, days, exercises, sessions, garmin
backend/               Worker entry point and composed tRPC router
  features/             auth, days, exercises, garmin, backup (routers and data access)
shared/                browser/server models, schemas, and formatters by feature
  days/ sessions/ exercises/ garmin/
migrations/             D1 schema
tests/                  unit and API tests (npm test)
API.md                  procedure and wire contract
```

### Data model

One JSON document per day (`days` table) is the source of truth. Each saved session and activity belongs to a training event. On every save the Worker rebuilds `exercise_log`, one row per session performance or activity. See the [data model in API.md](API.md#data-model) for the v7 shapes, exercise IDs, supersets, activities, legacy blocks, D1 tables, and local drafts.

### API seam

All app data traffic goes through `/api/trpc`. The browser imports only the `AppRouter` type from `backend/router.ts`; the Worker owns auth, validation, D1 access, and write conflicts. [API.md](API.md) lists every procedure, input, result, error, and save conflict rule.

The browser keeps its local draft for offline use, creates any custom exercise definitions through `exercises.create`, then syncs the day with `days.save`. The shared document schema is the transport boundary. Session edit rules live in shared pure functions; another client can reuse them without reproducing the UI. Agent intent-level mutations can extend the same router when those workflows are built. Keep the day document and revision check as the common persistence contract until then.

`putDay` checks the revision in the same D1 batch that writes the day, exercise index, and Garmin decision index. Of two saves from the same base, one wins and the other receives a conflict. Agent credentials and intent-level procedures remain future work on the same router.

- Read-only share links for PT / physio (per-person token, pick a date range).
- Progress view per exercise (top working set over time) from `exercise_log`.
- Planning: build a session ahead of time and tick sets off at the gym.
