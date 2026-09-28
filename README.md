# Trainoq

Mobile-first training log: morning check-in, sessions with warm-up / main / cool-down, supersets, set-by-set weights, calories, and a one-tap text summary to send to your PT or physio.

Runs on Cloudflare: a Worker serves the app and a tRPC API, data lives in D1.

## What it does

- **Day view**, defaults to today. Arrows or tap the date to move around; "Today" jumps back.
- **Keyboard date navigation** – the date picker shows its focus position, even though the native date input sits over the displayed date.
- **Morning check-in** – free text.
- **Start training session** – records the start time; "Finish" records the end. Both editable.
- **Warm-up / main / cool-down** – each section supports single exercises and supersets (A, B1/B2/B3…). Every exercise has a comment and numeric weight and reps for each set. Set type is independent of section:
  - `W1 W2` warm-up (dashed), `1 2 3` working (solid), `B1` back-off (tinted). Tap the label to change type.
  - **+ Set** on a standalone exercise and **+ Round** on a superset add the last type, or warm-up when empty. Correct values with the ± buttons (2.5 kg / 1 rep) or type. Tap the set label to cycle its type.
  - Supersets keep their identity even with zero or one member. Create an empty superset with **+ Superset**, or drag an existing exercise onto it to create a one-member superset. Add members through the picker or drag another standalone exercise onto the labelled superset target. If set types differ, review the alignment preview before appending rounds. Drag a round handle to reorder it without changing its recorded values.
  - Use the exercise or superset options sheet to delete sets, rounds, exercises or a whole superset with Undo. **Dissolve superset** converts members into standalone exercises with their comments and values intact. Taking out or deleting a member leaves the superset in place.
  - "Last Tue 22 Sep: …" under each exercise shows its previous entry in the same section.
- **Exercise search** – full-screen picker: recent first, starter list, search by name or alias (`rdl`, `ohp`). If it's not there, "Use "…"" saves what you typed and it shows up in search from then on.
- **Repeat** – an empty section offers "Repeat <last date>" to copy exercise references, superset grouping, and set types. Recorded weight and reps are cleared.
- **Calories** – per session, per extra activity (walk etc.), and a daily total.
- **Narrow screens** – activity name and numeric fields use two compact rows when a single row would hide the name.
- **Share day with PT / physio** – plain-text summary via the phone share sheet (WhatsApp, SMS, email) or copy.
- **Copy feedback** – the copy result stays visible in the share sheet until it closes.
- **Undo and errors** – each Undo action and error message stays visible until used or dismissed. Undoing an earlier deletion also clears later Undo actions because their snapshots no longer match the restored day.
- **Keyboard overlays** – action sheets, exercise search, and sharing keep focus inside while open. Escape closes them and returns focus to the button that opened them.
- **Reduced motion** – session indicators and overlays stay readable without animation when the device requests reduced motion.
- **Works with no signal** – every change is saved on the phone first and synced in the background. If the same day was edited on two devices, compare both versions and confirm which one replaces the other.
- **Sync retry** – when saving fails or the device is offline, the status badge has a keyboard-accessible retry action.
- **Installable** – "Add to Home Screen" gives a full-screen app that opens offline.
- **Backup** – menu → Download backup (JSON of every day and the exercise catalog).

## Run locally

```sh
npm install
npm run setup:local      # creates .dev.vars (password: change-me) and the local database
npm run dev              # http://localhost:5173
```

Local password is whatever `APP_PASSWORD` is in `.dev.vars`.

## Frontend screenshots

`npm run screenshots:check` compares login, full-page day, exercise picker, menu, share, and history screens at 320px, 390px, and 1280px, plus a dark conflict state, against the checked-in images in `visual/screenshots.pw.ts-snapshots/`. The test uses Chrome, a fixed Sydney time zone and locale, and a mocked tRPC response with fixed local day data, so it does not change your D1 database. Install Google Chrome before running it.

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
  features/             auth, days, exercises, sessions
backend/               Worker entry point and composed tRPC router
  features/             auth, days, exercises, backup (routers and data access)
shared/                browser/server models, schemas, and formatters by feature
  days/ sessions/ exercises/
migrations/             D1 schema
tests/                  unit and API tests (npm test)
API.md                  procedure and wire contract
```

### Data model

One JSON document per day (`days` table) is the source of truth. On every save the worker rebuilds `exercise_log` – one row per exercise occurrence – which powers search, "last time" hints and, later, progress charts. Types are in `shared/days/model.ts`, `shared/sessions/model.ts`, and `shared/exercises/model.ts`.

The current document is v3. Each session section holds ordered standalone performances and explicit supersets; both reference names in the exercise catalog by stable ID. Supersets store members, shared rounds and a result for every member-round pair. Older v1/v2 days and offline drafts convert on read; the Worker accepts them during the transition and saves v3. A backup exports v3 and the catalog without rewriting untouched D1 rows.

### API seam

All app data traffic goes through `/api/trpc`. The browser imports only the `AppRouter` type from `backend/router.ts`; the Worker owns auth, validation, D1 access, and write conflicts. [API.md](API.md) lists every procedure, input, result, error, and save conflict rule.

The browser keeps its local draft for offline use, creates any custom exercise definitions through `exercises.create`, then syncs the day with `days.save`. The shared document schema is the transport boundary. Session edit rules live in shared pure functions; another client can reuse them without reproducing the UI. Agent intent-level mutations can extend the same router when those workflows are built. Keep the day document and revision check as the common persistence contract until then.

Before simultaneous clients are active, make the D1 revision check and write atomic: `putDay` currently reads the revision before its write batch, so two concurrent saves can both pass the check. Then add agent credentials and intent-level procedures for the concrete agent workflows, using the same router rather than another transport.

## Next

- Garmin: pull daily and activity calories instead of typing them.
- Read-only share links for PT / physio (per-person token, pick a date range).
- Progress view per exercise (top working set over time) from `exercise_log`.
- Planning: build a session ahead of time and tick sets off at the gym.
