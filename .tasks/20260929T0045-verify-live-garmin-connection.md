---
title: Verify the Garmin connection against a live account
parent: 20260928T2315-connect-garmin-recurring
created_at: 2026-09-29T00:45:25+10:00
---

The recurring connection is implemented and tested against mocked Garmin responses, but Garmin's private sign-in and export endpoints have not been exercised from the deployed Cloudflare Worker. After deployment, enter the Garmin credentials in Trainoq's own connection form, verify sign-in and an original FIT download, and check that the first backfill and scheduled page import the expected activities. If Garmin requests MFA, complete it in the form. Do not send the password to chat or write credentials, tokens, or cookies to logs. Compare the imported active calories and stable identity with the sampled recordings already used by the FIT parser tests. If Garmin rejects Worker requests, capture only status and safe response metadata, then adapt the client and retest.
