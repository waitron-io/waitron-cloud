# Reproducible Local Cloud Stack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package the implemented Cloud control plane as a reproducible, local-only Docker Compose stack with executable clean-install, restart and upgrade evidence.

**Architecture:** One immutable Cloud image supplies all Node CLIs plus the pinned local gateway/storage binaries. A one-shot bootstrap writes private fixture configuration to a named volume; Compose gates long-running services on bootstrap, PostgreSQL health and completed migrations. A random-project proof exercises the lifecycle and emits a strict receipt.

**Tech Stack:** Docker Compose, Node.js 26, pnpm 9.15, PostgreSQL 18, SeaweedFS 4.47, Mailpit 1.31.1, HAProxy and WireGuard.

**Spec:** `docs/superpowers/specs/2026-09-27-local-cloud-stack-design.md`

## Global Constraints

- Bind every published port to `127.0.0.1`; create no live resource or public listener.
- Keep all generated secrets outside images and Git, mode `0600` under a mode-`0700` directory.
- Reuse existing service CLIs, migrations, gateway and storage contracts; do not add a parallel runtime API.
- Default startup includes only services whose local prerequisites can be generated safely.
- Backup verification and ACME/DNS reconciliation remain explicit opt-in profiles.
- Never print private values in logs or receipts.
- Every commit uses `git commit -s`; CI owns the full workspace suite.

## Review Focus

- An interrupted bootstrap must leave no partially accepted secret set; the next run either completes atomically or fails.
- Two simultaneous bootstraps must converge on one identity rather than overwrite one another.
- A stale gateway refresher must not lower the manifest sequence or extend authority from an old signing key.
- A failed migration must prevent every database consumer from starting.
- Reset and proof cleanup must target only the exact Compose project, including failure paths.

---

### Task 1: Bootstrap and runtime configuration boundary

**Files:**
- Create: `deploy/local-stack/bootstrap.mjs`
- Create: `deploy/local-stack/runtime.mjs`
- Create: `deploy/local-stack/bootstrap.test.mjs`
- Create: `deploy/local-stack/runtime.test.mjs`

**Interfaces:**
- Produces: `bootstrap(configDir, dependencies?)`, which creates version-1 `runtime.json`, gateway inputs and storage TLS/IAM files without replacing an existing valid configuration.
- Produces: `runtimeEnvironment(role, config)`, which returns the exact environment allowlist for `migrate`, `account`, `email`, `monitor`, `usage`, `probe`, `backup`, `gateway` or `manifest`.

- [x] **Step 1: Write failing bootstrap tests** for first creation, `0600` files, `0700` directories, idempotent fingerprints, concurrent calls, a valid Ed25519 empty-route manifest and rejection of malformed pre-existing state.
- [x] **Step 2: Run `node --test deploy/local-stack/bootstrap.test.mjs`** and confirm failure because the module is absent.
- [x] **Step 3: Implement minimal atomic bootstrap** with same-directory temporary files, exclusive creation, directory sync, random keys, OpenSSL-generated local certificates and versioned JSON validation.
- [x] **Step 4: Run the bootstrap tests** and confirm all pass without logging secret values.
- [x] **Step 5: Write failing runtime tests** that reject unknown roles and unsafe permissions, and prove each role receives only its required variables.
- [x] **Step 6: Implement the runtime allowlist and `spawn` launcher**, preserving signals and exit status while redacting configuration failures.
- [x] **Step 7: Run both test files and `pnpm typecheck`**, then commit with sign-off: `Add local stack configuration boundary`.

### Task 2: Immutable image and Compose dependency graph

**Files:**
- Create: `deploy/local-stack/Dockerfile`
- Create: `deploy/local-stack/local.env`
- Create: `deploy/local-stack/compose-contract.test.mjs`
- Modify: `compose.yaml`
- Modify: `.gitignore`
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 1's bootstrap files and runtime roles.
- Produces: Compose services `postgres`, `mailpit`, `bootstrap`, `migrate`, `storage`, `account`, `email-worker`, `monitor-worker`, `usage-reconciler`, `remote-probe`, `gateway-manifest` and `gateway`; opt-in `backup-worker` and `remote-reconciler` profiles.

- [x] **Step 1: Write the failing Compose contract test** that loads `docker compose config --format json` and asserts loopback bindings, health/dependency gates, pinned images/download digests, private configuration volume use, migration completion and profile boundaries.
- [x] **Step 2: Run the contract test** and confirm the existing Mailpit-only Compose file fails the service assertions.
- [x] **Step 3: Add the multi-stage image** with Node 26, pnpm 9.15, portal assets, gateway tools and architecture-specific SHA-256 verification for SeaweedFS 4.47.
- [x] **Step 4: Expand Compose minimally** using the Task 1 launcher, named state volumes, bounded stop periods and loopback-only published ports. Add root lifecycle scripts without embedding shell secrets.
- [x] **Step 5: Run `docker compose config --quiet` and the contract test** and confirm both pass.
- [x] **Step 6: Build the Cloud image** and run its bootstrap and migration entry points against disposable volumes.
- [x] **Step 7: Commit with sign-off:** `Package the local Cloud Compose stack`.

### Task 3: Gateway authority refresh and stack health

**Files:**
- Create: `deploy/local-stack/manifest-worker.mjs`
- Create: `deploy/local-stack/manifest-worker.test.mjs`
- Modify: `compose.yaml`
- Modify: `deploy/local-stack/runtime.mjs`

**Interfaces:**
- Consumes: bootstrap's cell ID, Ed25519 private key and gateway manifest path.
- Produces: monotonically increasing, atomically replaced, at-most-ten-minute empty-route manifests and a redacted status record.

- [x] **Step 1: Write failing fake-clock tests** for initial sequence, pre-expiry refresh, restart monotonicity, stale state refusal, atomic publication and abort shutdown.
- [x] **Step 2: Run the focused test** and confirm failure because the worker is absent.
- [x] **Step 3: Implement the smallest refresher** using the existing `signManifest`, a persisted sequence file and an abortable timer.
- [x] **Step 4: Run focused tests**, then start the gateway services and assert `status.json` reports `ready: true` with zero routes.
- [x] **Step 5: Restart only the manifest worker and gateway**, then assert the sequence increases and the gateway reuses its persistent accepted cache.
- [x] **Step 6: Commit with sign-off:** `Keep the local gateway authority current`.

### Task 4: Executable clean-install, restart and upgrade proof

**Files:**
- Create: `scripts/local-stack-proof.mjs`
- Create: `scripts/verify-local-stack-receipt.mjs`
- Create: `scripts/verify-local-stack-receipt.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `pnpm proof:local-stack [receipt]` and `pnpm verify:local-stack <receipt>`.
- Receipt schema version 1 records exact Cloud head/dirty state, project name, loopback bindings, image IDs, migration count, configuration fingerprints, database/storage persistence, phase timings and cleanup.

- [x] **Step 1: Write failing receipt-verifier tests** for a complete fixture and mutations covering missing health, public bindings, changed identity, missing marker/object, absent upgrade, dirty source and incomplete cleanup.
- [x] **Step 2: Run the verifier tests** and confirm failure because the verifier is absent.
- [x] **Step 3: Implement the strict verifier** with exact keys, safe integer/timestamp bounds and no secret-bearing fields.
- [x] **Step 4: Write the proof orchestrator** using a random Compose project and random loopback ports. In `finally`, run `docker compose down --volumes --remove-orphans` for that exact project.
- [x] **Step 5: Exercise clean install**: build, start with empty volumes, wait for healthy services, query API liveness/readiness, verify gateway status and storage TLS, count migrations, write a database marker and storage object.
- [x] **Step 6: Exercise restart**: stop/start the same project and prove marker, object and configuration fingerprints remain.
- [x] **Step 7: Exercise upgrade**: rebuild and force-recreate Cloud services, rerun migrations and prove the same evidence remains; record explicit rollback exclusions.
- [x] **Step 8: Run the verifier mutation suite and real proof**, retain the receipt path and timings, then commit with sign-off: `Prove local stack lifecycle`.

### Task 5: Operator guide and backlog reconciliation

**Files:**
- Create: `docs/local-deployment.md`
- Modify: `README.md`
- Modify: `.env.example`
- Modify: `docs/operations-status.md`
- Modify: `docs/backlog.md`
- Modify: `docs/superpowers/plans/2026-09-27-local-cloud-stack.md`

**Interfaces:**
- Consumes: the exact commands and observed receipt from Tasks 1-4.
- Produces: a cold-start operator path, profile prerequisites, health/status commands, upgrade/reset steps and explicit production/rollback limitations.

- [x] **Step 1: Document exact lifecycle commands** and every loopback port, volume, generated-secret boundary, opt-in profile prerequisite and recovery/reset effect.
- [x] **Step 2: Record measured proof output** without availability or capacity promises; distinguish same-schema recreate from database recovery and incompatible-schema rollback.
- [x] **Step 3: Update the Operations/deployment-readiness backlog entry** to mark the reproducible local stack complete and name remaining production deployment, secret custody, provider, scheduling and database-recovery work.
- [x] **Step 4: Run link/command searches, Compose config, focused tests, the receipt verifier and workspace typecheck**; mark completed plan checkboxes.
- [x] **Step 5: Commit with sign-off:** `Document the reproducible local deployment`.

### Task 6: Finish and land

**Files:**
- Review the whole branch and campaign ledger; no new product file is implied.

- [ ] **Step 1: Run the `finish-branch` workflow** in the registered worktree, including one isolated Claude run-it review because this branch changes deployment behavior.
- [ ] **Step 2: Triage every finding with evidence**, fix accepted behavior test-first, commit with sign-off and rerun affected focused checks.
- [ ] **Step 3: Push through normal hooks, open the PR and verify required CI on the exact head SHA.**
- [ ] **Step 4: Acquire the shared `main.lock` and run `land-branch` from the main checkout.**
- [ ] **Step 5: Confirm the exact merge SHA's CI, update D26 to landed with PR/SHA receipts, and append the final campaign checkpoint.**
