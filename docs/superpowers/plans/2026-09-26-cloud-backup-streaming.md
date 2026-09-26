# Cloud Backup Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Cloud retained-snapshot object transfers and verification inputs from whole-object buffers to bounded, replayable streams.

**Architecture:** Provider downloads are staged to private temporary files while size and SHA-256 are computed. Catalogue publication, upload retries, verification, and the isolated Waitron verifier consume a replayable object that opens a fresh stream for each attempt and must be disposed.

**Tech Stack:** TypeScript, Node.js streams and filesystem APIs, AWS SDK v3 S3 client, PostgreSQL test container, SeaweedFS local S3 fixture.

**Spec:** `docs/superpowers/specs/2026-09-26-cloud-backup-streaming-design.md`

## Global Constraints

- Keep the Waitron archive bytes and format unchanged.
- Keep SHA-256 metadata, object keys, conditional-create semantics, SSE-C headers, and retry identity unchanged.
- Keep the inclusive object bound at 1 through 536,870,912 bytes; do not raise the advertised 512 MiB end-to-end limit.
- Use private mode-0600 staged files and remove partial or completed stages on every outcome.
- Do not edit Waitron or claim live AWS/Google behavior from the local S3-compatible fixture.

## Review Focus

- A provider advertises one length but ends the body early: reject it and remove the partial stage.
- Cancellation or deadline fires between chunks: abort the pipeline, do not publish, and remove the partial stage.
- A retry starts after the first upload consumed its stream: reopen byte zero from the unchanged staged file.
- A conditional-create collision contains different bytes with the same length: reject it as `backup.object_conflict`.
- A capture expires during staging/upload: keep the object transfer non-authoritative and refuse the database publication.

---

### Task 1: Replayable staged objects

**Files:**
- Create: `packages/backups/src/object-transfer.ts`
- Create: `packages/backups/test/object-transfer.test.ts`

**Interfaces:**
- Produces: `ObjectReceipt`, `ReplayableObject`, `receipt(bytes)`, `bufferObject(bytes)`, and `stageReadable(body, contentLength, options)`.
- `ReplayableObject` exposes `receipt`, `open(): Readable`, and `dispose(): Promise<void>`.

- [ ] **Step 1: Write failing tests** for a generated multi-megabyte stream whose receipt is derived from hand-checked repeated bytes, for reopening the stage twice, and for truncated, oversized, cancelled, and deadline-expired streams. Assert the supplied temporary root is empty after each failure and after disposal.
- [ ] **Step 2: Run `pnpm --dir packages/backups exec node --test test/object-transfer.test.ts`** and confirm failure because the module and staged-object operations do not exist.
- [ ] **Step 3: Implement the minimal staging module** with `pipeline`, a byte-counting/hash transform, a private `mkdtemp` directory, a mode-0600 file, composed abort signals, exact length enforcement, and idempotent disposal.
- [ ] **Step 4: Re-run the focused test** and confirm every staged-object case passes without an archive-sized retained buffer.
- [ ] **Step 5: Commit with sign-off** as `feat: add replayable backup object stages`.

### Task 2: Stream S3-compatible downloads and replayable uploads

**Files:**
- Modify: `packages/backups/src/storage.ts`
- Modify: `packages/backups/test/storage.test.ts`
- Modify: `scripts/test-backup-storage.mjs`

**Interfaces:**
- Consumes: `ReplayableObject` and `stageReadable()` from Task 1.
- Produces: `BackupObjects.stage(key, streamKey?, options?)` and `BackupObjects.putStaged(key, source, streamKey?, options?)`; existing `read()` and `put()` remain compatibility wrappers.

- [ ] **Step 1: Add failing storage tests** using a complete fake S3 response shape to prove content length is passed on upload, a fresh `open()` stream is used for a transient retry, cancellation reaches the provider, conditional conflicts stream and compare existing bytes, and missing SSE-C confirmation still fails.
- [ ] **Step 2: Run the focused storage tests** and confirm they fail because the staged methods and retry behavior are absent.
- [ ] **Step 3: Implement staged provider operations** with the existing bucket/key/encryption inputs, the existing 30-second default deadline, at most two transient attempts, `IfNoneMatch: "*"`, and streaming comparison after HTTP 412.
- [ ] **Step 4: Extend the SeaweedFS proof** to generate a large source in fixed-size chunks, upload it through `putStaged`, download it through `stage`, compare literal size/digest, exercise wrong SSE-C and changed-byte conflict, and emit peak `arrayBuffers`/RSS deltas without capacity claims.
- [ ] **Step 5: Run `pnpm --dir packages/backups test` and `pnpm test:backup-storage`** and confirm the package and real local provider paths pass.
- [ ] **Step 6: Commit with sign-off** as `feat: stream backup object storage transfers`.

### Task 3: Make publication and verification consume stages

**Files:**
- Modify: `packages/backups/src/catalogue.ts`
- Modify: `packages/backups/src/worker.ts`
- Modify: `packages/backups/src/waitron-verifier.ts`
- Modify: `packages/backups/test/catalogue.test.ts`
- Modify: `packages/backups/test/worker.test.ts`
- Modify: `packages/backups/test/waitron-verifier.test.ts`
- Modify: backup test fixtures that implement `ObjectStore` or `RestoreVerifier`

**Interfaces:**
- Consumes: `ReplayableObject`, `BackupObjects.stage()`, and `BackupObjects.putStaged()`.
- Produces: `ObjectStore.stage()`/`putStaged()` and `RestoreVerifier(source: ReplayableObject, keys, point, signal)`.

- [ ] **Step 1: Add failing catalogue tests** whose store throws if legacy `read()`/`put()` is called, records stage disposal, and proves publication, verification, mismatch, restore failure, deletion race, and capture-expiry outcomes.
- [ ] **Step 2: Run the real PostgreSQL catalogue test** through `node scripts/test-postgres.mjs exec pnpm --dir packages/backups exec node --test test/catalogue.test.ts` and confirm the new assertions fail on the buffered path.
- [ ] **Step 3: Update the catalogue and worker contracts** so publication and verification use staged objects in `try/finally`, compare their receipts, preserve every existing transaction/fence, and never expose a stage after disposal.
- [ ] **Step 4: Add a failing verifier test** passing a chunked replayable source and asserting the real child receives the exact SQLite bytes while both the verifier scratch directory and source stage are cleaned by their owners.
- [ ] **Step 5: Pipeline the source into `input.backup.enc`** with the worker signal before launching the child; retain the existing filesystem permissions and process isolation.
- [ ] **Step 6: Run the focused PostgreSQL catalogue/worker tests and verifier tests** and confirm all prior behavior plus stage cleanup passes.
- [ ] **Step 7: Commit with sign-off** as `refactor: stream backup publication and verification`.

### Task 4: Proofs and operator-facing limits

**Files:**
- Modify: `scripts/test-local-backups.mjs`
- Modify: `docs/local-backups.md`
- Modify: `docs/backlog.md`

**Interfaces:**
- Consumes: `BackupObjects.stage()` and `ReplayableObject.open()`.
- Produces: a local memory/transfer receipt and current documentation of proven versus remaining bounds.

- [ ] **Step 1: Change the two direct recovery downloads** to pipeline staged sources into their input files and dispose them, leaving Waitron restoration behavior unchanged.
- [ ] **Step 2: Run the focused storage proof, backups PostgreSQL tests, and workspace typecheck**; when a compatible Waitron checkout is available, run the existing two-venue local backup proof and retain its machine-readable receipt.
- [ ] **Step 3: Update documentation** with the measured fixture size and memory deltas, bounded Cloud paths, unchanged 512 MiB ceiling, and remaining Waitron/live-provider work.
- [ ] **Step 4: Run formatting and diff checks**, inspect every changed consumer again with `rg`, and confirm no whole-object production read remains on the retained-snapshot worker path.
- [ ] **Step 5: Commit with sign-off** as `docs: record bounded backup transfer evidence`.
