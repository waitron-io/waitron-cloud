# Managed backups implementation plan

> For agentic workers: use superpowers:executing-plans inline, one task at a time.

**Goal:** Prove encrypted Cloud storage and real Waitron recovery locally.
**Architecture:** A Cloud backup package owns provider access, encrypted keys and a
PostgreSQL catalogue. Waitron retains archive and restore behavior. The local harness
uses two disposable real venues and a pinned TLS object store.
**Tech stack:** Node, TypeScript, PostgreSQL, S3 SDK, SeaweedFS 4.47, Litestream 0.5.17.
**Spec:** `docs/superpowers/specs/2026-09-24-managed-backups-design.md`.

## Global constraints

No live AWS deployment; no customer data. Signed-off commits and normal hooks. Keys
never enter logs or plaintext operation records. Preserve all existing restore/fiscal
assertions. Do not duplicate the separately active Waitron stream implementation.

## Review focus

- A successful upload with missing encryption must fail the provider proof.
- Credentials for one venue or backup kind must be refused in another scope.
- An upload receipt must not claim a verified restore.
- Concurrent cleanup must not delete the last verified or actively restoring snapshot.
- A replacement grant must not activate Waitron or resurrect old Cloud credentials.

## 1. Provider and protected keys

Files: `packages/backups/src/{keys,storage}.ts`, corresponding node tests,
`scripts/backup-storage-fixture.mjs`, package manifest and lockfile.

- [x] Write failing tests for context-bound key encryption, rotation, wrong master key,
  immutable writes and stream/archive storage boundaries; run and inspect failures.
- [x] Implement versioned keys and the S3 adapter. Require TLS, bounded operations,
  server-selected bucket/key and short-lived scope-specific credentials.
- [x] Run the pinned provider: correct key succeeds; missing/wrong key fails; credential
  A cannot read/write B; capture cannot delete snapshots; expired authority fails.
- [x] Commit the provider and key unit with `git commit -s`.

## 2. Durable catalogue and retention

Files: migration `011_managed_backups.sql`, registration migration list, migration-count
consumers; `packages/backups/src/catalogue.ts` and PostgreSQL tests.

- [x] Write failing tests for active installation binding, immutable publication,
  byte verification, rotation/old-key recovery and verification state transitions.
- [x] Implement registration-linked key versions and catalogue records. Only a trusted
  restore worker can write a verification result for the exact digest.
- [x] Add concurrent retention tests protecting the last verified snapshot and active
  restore references, then implement claim/delete/finalise with resumable tombstones.
- [x] Update migration tests without removing their existing behavioral assertions.
- [x] Run focused tests and commit with sign-off.

## 3. Owner-authorised recovery

Files: `packages/backups/src/recovery.ts`, key-bound target proof and PostgreSQL tests.

- [x] Write failing tests for owner/CSRF checks, cross-organisation refusal, exact retry,
  conflicting operation body, simultaneous requests, changed target and expired proof.
- [x] Implement one active operation per venue and target-key-bound secret delivery.
  Preserve a separate restored state; no Cloud grant activates Waitron.
- [x] Verify failed restore remains retryable and credentials are absent from status.
- [x] Run focused tests and commit with sign-off.

## 4. Real Waitron and Litestream integration

Files: Cloud `scripts/test-local-backups.mjs`, Waitron-owned fixture/capture integration,
`docs/local-backups.md`, both backlogs and integration contract status.

- [x] Create actual Waitron snapshots, upload them and restore through its existing
  validation/migration/module-hook path onto disposable replacements.
- [x] Prove older-key snapshot recovery after rotation, absent stream, bad object,
  failed verification and no worker side effects during isolated verification.
- [x] Run Litestream 0.5.17 with the real provider and prove restored committed writes.
- [ ] Recheck landed Waitron stream interfaces. Wire complete continuous server restore
  only once its sealed state and cold restore contract exist; record any actual blocker.
- [x] Record exact clean heads, commands and measured outcomes; update docs/backlogs.

## 5. Finish and land

- [ ] Rebase, run one isolated Claude run-it review for each meaningful code branch,
  triage findings with failing regressions, push normally and wait for current-head CI.
- [ ] Land from main, refresh dependencies, remove owned worktrees and branches,
  verify remote deletion and audit backlog status. Report any incomplete dependency.

## Execution status

2026-09-24: focused backup tests pass (15), provider isolation and actual 15-minute
credential expiry pass. The real two-venue proof passes snapshot validation/restore,
Litestream committed writes, deleted-stream refusal and older-key snapshot recovery.
Full continuous server restore remains blocked: Waitron main `95f02e0bc` still lists
slice-2 sealed state, stream supervision and cold restore as pending. No activation
or customer backup screens are claimed. The isolated Claude review took 505 seconds; its accepted findings now have passing
regressions. Waitron fixture PR #552 is merged. Cloud current-head CI and landing
are the remaining branch gates.
