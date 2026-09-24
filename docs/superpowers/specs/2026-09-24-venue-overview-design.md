# Customer venue overview

The owner authorised four sequential features with automatic finish/land and delegated
routine design choices. This first feature makes existing connection and backup data
useful from the English/Spanish account portal. Keep the single-venue journey simple.

Extend the existing account installation list with public overview metadata: organisation
and business names, business country, latest retained snapshot capture time and latest
currently verified snapshot capture time. Read only undeleted, non-deleting snapshots.
Do not infer recoverability from upload time, or label an old verified point current.
Legacy unnamed businesses fall back to their identifiers; do not invent venue names.

Keep the current live-session and membership checks, rate limits, five-minute observation
freshness, owner-only stop-access confirmation and secret-free account response. Recheck
membership and session while assembling overview metadata. A removed membership must not
receive a delayed overview. Read-only status remains available to organisation members;
recovery authority is still owner-only.

Show one organisation at a time. Hide the selector when only one exists. Group cards by
business, show the environment and venue identifier, and retain existing connection and
service status. Separate latest snapshot from latest verified snapshot. A verified snapshot
older than 48 hours gets a dated/stale label (an initial daily-snapshot display threshold,
not a promised data-loss target). No verified snapshot is shown explicitly. Account change
clears selection and data; refresh failures display an error alongside previously read data.

Prove the backend with real PostgreSQL (membership isolation, deleted/failed snapshots,
no keys in responses). Prove both languages in Chromium at phone width, including organisation
switching, timestamps, freshness, accessibility and the existing revoke journey.
