---
title: Keep an edited finish time on the session's date
created_at: 2026-10-23T01:18:29+11:00
---

Editing a session's finish time keeps the date of the moment Finish was tapped. `frontend/features/sessions/session.tsx` sets `endedAt = withClock(x.endedAt, value)`, and `withClock` keeps `endedAt`'s own date.

On 12 Oct 2026 a session started at 20:51 was finished just after midnight. The finish time was then set to 21:20, which stored 13 Oct 21:20, a 1468-minute session. The day was corrected in D1 on 23 Oct.

Anchor the edited finish time to the session's start: the first matching clock time at or after `startedAt`, so a session that crosses midnight still lands on the next day. Reproduce with a failing test first.
