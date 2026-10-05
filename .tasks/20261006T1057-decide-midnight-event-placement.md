---
title: Decide how events spanning midnight are stored
parent: 20261006T1057-implement-training-events
created_at: 2026-10-06T10:57:43+11:00
---

The v7 day document contains events for one local date. The current implementation anchors an event to its day. Define how a visit crossing local midnight should appear and whether items can remain in one event without creating duplicate records. The 6 October training-events report calls out this boundary and provides no recorded user decision.
