# Local Cell Movement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move one venue between existing local gateway cells through a durable, revision-bound operation while preserving its hostnames and isolating every other venue.

**Architecture:** Extend the existing PostgreSQL placement store with a four-state move record (`staged`, `ready`, `completed`, `cancelled`). A staged destination route is exported alongside current placements while the source route remains active. A trusted operator records the exact destination manifest sequence whose route was tested, then commit atomically changes the active placement, increments the installation configuration revision and leaves both cells to publish newer manifests. Cancellation removes only the staged route; immutable completed results make retries after lost replies safe.

**Tech Stack:** TypeScript, Node test runner, PostgreSQL 18, signed gateway manifests, local Docker/WireGuard/HAProxy fixtures.

**Spec:** `docs/backlog.md` (“Provisioning and placement” and “Cells”), `docs/product-and-platform.md` (cell movement boundary), and Lane D queue item D20.

## Global Constraints

- Existing customer-facing staff/public hostnames remain byte-for-byte unchanged.
- Only existing Spain/AWS cells in the installation environment are eligible; no provisioning, country, Kubernetes or live provider work is added.
- A source route remains current until a destination route from this exact move and revision has been tested.
- Stale revisions, old replies, competing moves and failed destination applies cannot change the active placement.
- The move does not edit Waitron or broaden gateway, venue or tenant authority.

## Review Focus

- A hostname or installation revision change after staging must invalidate readiness and commit.
- Competing stage/ready/commit calls must admit one move and one revision increment.
- Destination capacity allocation must stay unique under concurrency and must not reclaim an uncertain address.
- A lost commit reply must return the same completed result without another configuration revision.
- Publishing/cancelling a staged destination must leave the unrelated venue and source placement unchanged.

---

### Task 1: Durable movement state and manifest projection

**Files:**
- Create: `packages/registration/migrations/023_remote_cell_moves.sql`
- Modify: `packages/registration/src/migrate.ts`
- Modify: `packages/account-http/test/server.test.ts`
- Modify: `packages/remote-access/src/placement.ts`
- Create: `packages/remote-access/test/movement.test.ts`

**Interfaces:**
- Produce `RemoteAccessStore.stageMove`, `markMoveReady`, `completeMove` and `cancelMove`.
- Extend `RemoteAccessStore.manifest(cellId)` so valid staged/ready moves appear only in the destination cell and active placements continue to appear only in their source cell.

- [ ] Write a real-PostgreSQL test that stages a move, observes unchanged hostnames in both source and destination manifests, refuses commit before readiness, records a generated destination sequence, commits once, and returns the same result on retry.
- [ ] Run the focused file and confirm it fails because the migration and movement methods do not exist.
- [ ] Add the migration and minimal state-machine implementation. Lock the installation before the target cell, bind every transition to the stored expected revision, keep completed/cancelled rows for retry identity, and advance target allocation without reclaiming cancelled addresses.
- [ ] Run the focused test green, then add RED cases for a concurrent competing move, stale revision, target apply cancellation, revoked installation, capacity/environment mismatch, and unrelated-venue isolation.
- [ ] Implement the smallest validation and transaction changes for those cases and run the placement/movement/probe focused suite green.
- [ ] Mutate the revision fence, ready gate and completed-result branch in a disposable checkout; each corresponding test must fail.

### Task 2: Trusted operator workflow

**Files:**
- Modify: `packages/remote-access/src/operator-cli.ts`
- Modify: `packages/remote-access/package.json`
- Modify: `docs/local-remote-access.md`

**Interfaces:**
- Add `move-stage`, `move-ready`, `move-commit` and `move-cancel` commands using trusted local JSON inputs.
- `move-ready` accepts the destination gateway sequence only after the operator has tested that applied route; the store verifies that sequence was generated for this staged move.

- [ ] Write a subprocess test that proves invalid/stale inputs fail closed and a complete staged workflow emits the same durable JSON after a lost-reply retry.
- [ ] Run it RED because the commands are absent.
- [ ] Add only the four command dispatches and document their ordered use, failure recovery and the requirement to publish newer manifests to both cells after commit/cancel.
- [ ] Run the operator and package-focused tests green.

### Task 3: Real two-cell local proof and receipt

**Files:**
- Modify: `scripts/test-local-remote.mjs`
- Create: `scripts/verify-cell-movement-receipt.mjs`
- Modify: `package.json`
- Modify: `docs/local-remote-access.md`
- Modify: `docs/backlog.md`

**Interfaces:**
- Extend the existing owned local fixture with a second signed gateway cell and one destination peer configuration.
- Emit `movement.version=1` with staged, failed-apply rollback, committed, old-route-revoked and measured reconnection evidence.

- [ ] Add the receipt verifier first; run it against the existing receipt and observe the missing-movement failure.
- [ ] Stage venue A while venue B remains on the source cell. Publish the destination manifest, apply the destination peer configuration, test the actual TLS/public route, and only then mark readiness.
- [ ] Cancel one deliberately failed stage and prove the source route remains healthy; create a fresh operation, commit it, publish newer manifests to both cells, and prove the old gateway refuses venue A while venue B remains healthy.
- [ ] Preserve venue A’s exact hostnames/certificates, measure reconnection, and include the destination/source manifest sequences in the machine-readable receipt.
- [ ] Update the backlog with what the local proof establishes and retain provider/DNS/reconciler/deployment recovery-time work explicitly.
- [ ] Run the real proof and verifier, then mutate hostname stability and other-venue isolation evidence and confirm the verifier fails.

### Task 4: Focused completion and branch workflow

**Files:** all changed files above.

- [ ] Run the PostgreSQL-backed remote-access package suite, workspace typecheck, receipt verifier and `git diff --check`.
- [ ] Commit every logical change with `git commit -s` and leave the feature worktree clean.
- [ ] Run the authorised `finish-branch` workflow, resolve verified review findings, push through the normal hook and obtain green current-head CI.
- [ ] Hold the shared `main.lock` for the complete authorised `land-branch` workflow, then confirm exact-merge CI on the literal merge SHA before marking D20 landed.
