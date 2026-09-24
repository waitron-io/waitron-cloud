# Local background backup worker

Run backup maintenance without an owner keeping the portal open. This local integration
worker operates only on configured test venues. It verifies actual Waitron restores,
cleans expired snapshots under the existing retention rules, and removes abandoned
uploads. It never starts a venue server, activates trading or sends customer emails.

## Durable work and retries

Add PostgreSQL jobs for snapshot verification, retention and incoming cleanup. Each
snapshot has one verification job; each venue has one job of each maintenance kind.
A scheduling pass adds at most100 missing jobs per kind. Claim one due job using
FOR UPDATE SKIP LOCKED, a random claim ID and a120-second lease. Successful verification
is due again after7 days; maintenance after1 minute. Failed jobs retry after30 seconds,
doubling up to15 minutes, for8 attempts. Expose failed jobs and a bounded operator retry.
Report due/running/failed counts, oldest due time and fixed diagnostics without secrets.

Pass a claim fence into catalogue mutation phases. Check the current claim and lease
under a row lock before preparing a verification and before recording its result, and
before/finalising maintenance writes. An expired worker cannot overwrite a newer result.
Lock venue location before job when both are needed; claim transactions end before
catalogue work. Repeated exact object deletes are allowed after interrupted work.

## Restore process

Use a Cloud-owned process adapter that imports an explicitly configured Waitron checkout's
validateArtifact and writeValidated. Check archive capture time, modules and source node,
SQLite integrity, restore hooks and exclusion of source Cloud credentials/staff TLS keys.
Restore into a fresh private temporary directory and remove it when the process exits.
Do not edit Waitron or add AGENTS.md there; its instructions remain in CLAUDE.md.

The child gets a minimal environment and keys through stdin, Node network permission
denied, writes limited to its temporary directory, a512MiB heap setting,30-second hard
timeout and bounded output. Kill the process group on cancellation and await termination
before cleanup. Object memory remains bounded to512MiB by the existing storage adapter.
These limits support trusted local integration; production container isolation and total
CPU/memory/disk limits remain a deployment gate. Pin configured storage endpoint/region
before using operator credentials; use verified HTTPS and the optional local CA.

## Abandoned uploads

A reservation can create a new point for24 hours. Exact retries of a committed publication
remain valid. Cleanup starts after24h16m, allowing15-minute credentials and the1-minute
exchange token to expire. Persist the expiry tombstone before deleting objects. A point
that was committed permits incoming-only deletion; without a point, remove incoming and
any orphan snapshots/<captureId> copy. Record cleaned_at after successful deletes. Retain
the tombstone so retries cannot reuse the UUID. Grant issuers must honour the reservation
deadline; the separate authenticated capture/grant endpoint remains future work.

## Implementation and proof

1. Add migration/job interface and failing real PostgreSQL tests. Implement bounded
   scheduling/claim/backoff/status and fences; cover two workers and lease takeover.
2. Add capture expiry and resumable cleanup with publish/cleanup race and restart tests.
3. Add CLI, fixed configuration errors, actual Waitron verifier, cancellation and process
   bounds. Exercise malformed output, timeouts and wrong configuration with real processes.
4. Route the existing local encrypted-backup proof through the worker and real Waitron
   restore code, retaining all prior archive, key-rotation and recovery assertions.
5. Update runbook/backlog. Focused checks, isolated finish-branch review, exact-head CI,
   land and clean up, then start monitoring/alerts.
