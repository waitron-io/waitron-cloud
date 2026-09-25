# Remote Health Probes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bounded Cloud runner that proves the configured public route and staff TLS endpoint through the real gateway and emits revision-bound observations.

**Architecture:** A PostgreSQL target reader supplies only current authorised placements. A network probe pins public DNS results, performs the existing bot challenge and a separate staff TLS handshake, and returns redacted typed results. A small concurrent runner and CLI emit completed results without persisting incident state; the existing local two-venue proof exercises the implementation through HAProxy and WireGuard.

**Tech Stack:** Node 24 TypeScript, PostgreSQL, `node:https`, `node:tls`, `node:dns`, Node test runner, Docker/HAProxy/WireGuard local fixtures.

**Spec:** `docs/superpowers/specs/2026-09-25-remote-health-probes-design.md`

## Global Constraints

- Read targets only from current non-revoked Cloud placements; never accept a caller URL, path or hostname.
- Production connections use port 443, verified TLS and public unicast DNS addresses; only injected test fixtures may route configured names to private addresses.
- Limit target batches to 100, DNS answers to four, concurrent targets to four, each request to five seconds, each service check to fifteen seconds and each response to 65,536 bytes.
- Follow the existing public challenge normally and never emit challenge tokens, cookies, response bodies, addresses or raw errors.
- Emit schema version 1 with installation ID, venue ID and configuration revision; D2 owns persistence and incidents.
- Do not modify Waitron source, install trust globally, disable TLS verification, provision resources or send live customer traffic.

## Review Focus

- DNS rebinding or a private/custom hostname must fail before a socket opens; the address-policy test pins both cases.
- A 403 unrelated to the real challenge must not look healthy; the public fixture test changes the challenge page and expects `challenge`.
- Multiple `Set-Cookie` headers or a malformed access cookie must not be replayed; the solve-response test expects `challenge`.
- Shutdown during proof solving or network I/O must emit no completed success; the runner abort test holds one target open.
- A replacement/revision change after target selection must remain visible in the emitted revision; the PostgreSQL target test changes the current installation and proves old and new identities never merge.

---

### Task 1: Authorised probe targets

**Files:**
- Create: `packages/remote-access/src/probe-targets.ts`
- Create: `packages/remote-access/test/probe-targets.test.ts`
- Modify: `packages/remote-access/package.json`

**Interfaces:**
- Consumes: `pg.Pool`, `installations`, `installation_services`, `remote_placements`, `remote_hostnames` and the current-installation invariant `superseded_by IS NULL`.
- Produces: `RemoteProbeTarget {installationId:string; venueId:string; revision:number; staffHostname:string; publicHostname:string}` and `new RemoteProbeStore(pool).targets(limit?:number): Promise<RemoteProbeTarget[]>`.

- [ ] **Step 1: Write the failing PostgreSQL target tests**

Create two test venues with placements, then assert exact isolated targets and revisions:

```ts
const targets = await probes.targets();
assert.deepEqual(targets.map(t => [t.installationId, t.venueId, t.revision]), [
  [first.installationId, first.venueId, 1],
  [second.installationId, second.venueId, 1],
]);
```

Also assert `targets(0)` and `targets(101)` reject, `targets(1)` returns one stable row, and unconfigured, revoked and superseded installations are absent. Complete a replacement fixture and prove the old installation does not reappear under the venue's new identity.

- [ ] **Step 2: Run the test and verify RED**

Run: `node scripts/test-postgres.mjs exec pnpm --dir packages/remote-access exec node --test test/probe-targets.test.ts`

Expected: FAIL because `../src/probe-targets.ts` does not exist.

- [ ] **Step 3: Implement the bounded query**

Validate `limit` is an integer from 1 through 100. Use one parameterised query joining the current installation, configured remote-access service, placement and two hostname rows; require `revoked_at IS NULL`, `superseded_by IS NULL` and `state <> 'unconfigured'`; order by venue and installation IDs and apply `LIMIT $1`. Convert the PostgreSQL revision to a JavaScript number and reject unsafe values.

- [ ] **Step 4: Run target tests and package typecheck**

Run the Step 2 command and `pnpm --dir packages/remote-access typecheck`.

Expected: target tests PASS and TypeScript reports no errors.

- [ ] **Step 5: Commit the target reader**

Run `git add packages/remote-access && git commit -s -m 'feat: derive remote probe targets'`.

### Task 2: Verified public and staff probes

**Files:**
- Create: `packages/remote-access/src/probe.ts`
- Create: `packages/remote-access/test/probe.test.ts`

**Interfaces:**
- Consumes: one `RemoteProbeTarget`, an `AbortSignal`, normal DNS/TLS roots, and optional test-only `connect(hostname)` returning an exact `{address,family,port}` for configured fixture names.
- Produces: `probeTarget(target, options): Promise<RemoteProbeResult>` where each `public` and `staff` field is either a certificate-bearing success or a fixed-code failure.

- [ ] **Step 1: Write failing address and staff TLS tests**

Generate a local root plus valid, wrong-host and untrusted leaf certificates. Assert the default resolver refuses loopback before connecting, while an injected exact fixture connection succeeds only when SNI matches and the supplied CA trusts the leaf. Assert refused, timed-out, wrong-host and untrusted endpoints return only fixed codes and contain no raw error or address.

Name the discriminating production change in the tests: deleting public-address validation must make the loopback test open a socket; deleting `servername` or `rejectUnauthorized` must make wrong-host/trust tests fail.

- [ ] **Step 2: Run the staff tests and verify RED**

Run: `pnpm --dir packages/remote-access exec node --test --test-name-pattern='address|staff' test/probe.test.ts`

Expected: FAIL because `probeTarget` is missing.

- [ ] **Step 3: Implement pinned address resolution and staff TLS**

Add fixed address classification for IPv4/IPv6 loopback, private, link-local, carrier NAT, documentation, benchmark, multicast and reserved ranges. Resolve at most four answers once, then connect by address with `servername: target.staffHostname`, certificate verification on, an abortable five-second socket timer and a fifteen-second service deadline. Convert `X509Certificate.validFrom`, `validTo` and `fingerprint256` into the public certificate result only after `secureConnect`.

- [ ] **Step 4: Verify staff GREEN**

Run the Step 2 command.

Expected: all address/staff cases PASS without warnings.

- [ ] **Step 5: Write failing public challenge tests**

Place `createPublicGate` behind a real HTTPS listener with the same injected loopback mapping. Assert the sequence is 403 challenge page, exact challenge JSON, bounded proof, one secure host cookie, then 200 JSON. Add cases for false 403 page, malformed/difficult challenge, duplicate/malformed cookie, redirect, non-JSON success, 65,537-byte response, refused connection, timeout, wrong hostname and untrusted certificate. Assert the recorded certificate matches the outer public TLS leaf.

- [ ] **Step 6: Run the public tests and verify RED**

Run: `pnpm --dir packages/remote-access exec node --test --test-name-pattern='public' test/probe.test.ts`

Expected: FAIL because the public service is not implemented.

- [ ] **Step 7: Implement the public proof**

Use one pinned address for all four HTTPS requests. Never follow redirects. Bound response collection before concatenation. Validate the challenge object has only `challenge` and `difficulty`, difficulty is an integer from 8 through 22, and solve no more than `2 ** difficulty * 16` candidates in batches that yield and check the abort signal. Require exactly one `__Host-waitron-public` cookie carrying no control characters and send no other cookie or credential. Require the final 200 body to parse as JSON.

- [ ] **Step 8: Run all probe tests and typecheck**

Run `pnpm --dir packages/remote-access exec node --test test/probe.test.ts` and `pnpm --dir packages/remote-access typecheck`.

Expected: all probe cases PASS and TypeScript reports no errors.

- [ ] **Step 9: Commit the network probes**

Run `git add packages/remote-access && git commit -s -m 'feat: probe remote HTTPS and staff TLS'`.

### Task 3: Bounded runner, shutdown and CLI

**Files:**
- Create: `packages/remote-access/src/probe-runner.ts`
- Create: `packages/remote-access/src/probe-cli.ts`
- Create: `packages/remote-access/test/probe-runner.test.ts`
- Modify: `packages/remote-access/package.json`
- Modify: `package.json`

**Interfaces:**
- Consumes: `RemoteProbeStore.targets(100)`, `probeTarget`, `DATABASE_URL`, process signals and an optional injected output callback for tests.
- Produces: `runRemoteProbes(targets, probe, {concurrency:4, signal, result}): Promise<void>` and root commands `pnpm remote:probe --once` / `pnpm remote:probe`.

- [ ] **Step 1: Write failing runner tests**

Use six synthetic targets and a held probe promise. Assert no more than four execute at once, a failure still lets the other targets run, and result callbacks receive only completed target results. Abort while two probes are held and assert neither can later deliver a success. Assert result order is completion order but each result retains its own installation, venue and revision.

- [ ] **Step 2: Run runner tests and verify RED**

Run: `pnpm --dir packages/remote-access exec node --test test/probe-runner.test.ts`

Expected: FAIL because `probe-runner.ts` does not exist.

- [ ] **Step 3: Implement the runner and redacted CLI**

Use four promise workers over a shared next index. Check abort before taking work and before emitting a result. The CLI validates only no argument or `--once`, requires `DATABASE_URL`, uses a small PostgreSQL pool with connection and statement timeouts, emits `JSON.stringify(result)` per completed target, repeats after 60 seconds in continuous mode, and aborts on `SIGINT`/`SIGTERM`. Startup/database errors print one fixed diagnostic; per-target failures remain JSON observations and do not make the process fail.

- [ ] **Step 4: Run runner tests, package tests and typecheck**

Run `pnpm --dir packages/remote-access exec node --test test/probe-runner.test.ts`, then the focused PostgreSQL package command from Task 1, then `pnpm --dir packages/remote-access typecheck`.

Expected: all focused checks PASS.

- [ ] **Step 5: Commit the runner**

Run `git add package.json packages/remote-access && git commit -s -m 'feat: run bounded remote probes'`.

### Task 4: Real gateway proof and operator documentation

**Files:**
- Modify: `scripts/test-local-remote.mjs`
- Modify: `docs/local-monitoring.md`
- Modify: `docs/local-remote-access.md`
- Modify: `docs/backlog.md`

**Interfaces:**
- Consumes: the two authorised placements and actual gateway loopback port already created by `scripts/test-local-remote.mjs`.
- Produces: a receipt check showing both venues passed the new public challenge and staff TLS probes through HAProxy/WireGuard, plus the documented local command and remaining D2 boundary.

- [ ] **Step 1: Add the failing integration assertion**

Before sending synthetic installation health, call `RemoteProbeStore.targets()` and `probeTarget()` for both venues with an exact fixture mapping from each configured hostname to `127.0.0.1:<gatewayPort>` and the Pebble CA. Assert two isolated schema-v1 results, matching revisions, both services healthy and certificate expiry/fingerprint evidence present. Temporarily force one target's public hostname to the other venue in the assertion and verify it fails, then restore the valid assertion.

- [ ] **Step 2: Run the real proof and verify RED**

Run:

```sh
WAITRON_CHECKOUT=/Users/clintongormley/workspace/repos/waitron \
REMOTE_RECEIPT=/tmp/cloud-remote-probe-receipt.json \
node scripts/test-postgres.mjs exec node scripts/test-local-remote.mjs
```

Expected before the integration code is completed: FAIL at the new probe assertion while the existing gateway fixture is reachable.

- [ ] **Step 3: Wire the valid fixture mapping and receipt**

Keep the injected mapping inside the local script; do not add it to CLI configuration. Add the measured probe check to the existing receipt, and gate the later synthetic healthy installation report on both functional results being healthy.

- [ ] **Step 4: Update the guides and backlog**

Document `pnpm remote:probe --once`, JSONL output, public-DNS/TLS requirements, fixed limits, graceful shutdown and that D1 does not create incidents. Update the Service monitoring backlog text from “external functional probes” to the exact landed capability and leave durable revision-fenced history, expiry incidents and recovery transitions for D2.

- [ ] **Step 5: Run focused final verification**

Run the real proof from Step 2, `node scripts/test-postgres.mjs exec pnpm --dir packages/remote-access test`, `pnpm --dir packages/remote-access typecheck`, and `git diff --check`.

Expected: the real proof prints the new PASS line and writes a receipt; all remote-access tests and typecheck pass; diff check is clean.

- [ ] **Step 6: Prove critical guards in a disposable checkout**

Copy the committed tree to a temporary checkout, delete the production private-address check and confirm the address negative control fails; restore it, delete SNI hostname verification and confirm the wrong-host test fails; restore it, allow success emission after abort and confirm the runner abort test fails. Record the commands and failing test names in `progress.log`, never in product docs.

- [ ] **Step 7: Commit docs and real proof**

Run `git add scripts/test-local-remote.mjs docs/local-monitoring.md docs/local-remote-access.md docs/backlog.md && git commit -s -m 'test: prove remote health probes through gateway'`.

### Task 5: Finish and land

**Files:**
- Modify only files required by accepted review findings.

**Interfaces:**
- Consumes: the complete D1 branch and its focused receipts.
- Produces: signed commits, one retained Claude run-it report, current-head green CI, a merged PR and exact main CI receipt.

- [ ] **Step 1: Run `finish-branch` in the feature worktree**

Follow `~/.codex/skills/finish-branch/SKILL.md`; this production branch requires the independent Claude run-it review. Fix accepted findings test-first and re-run their focused checks.

- [ ] **Step 2: Verify PR-head CI**

Record the exact head SHA and GitHub Actions run ID. Wait for the required current-head run; do not substitute a newer or older SHA.

- [ ] **Step 3: Serialize and run `land-branch`**

Acquire `~/waitron-campaign-shared/main.lock` with `mkdir`, run the authorised land skill from the main checkout through install and cleanup, then release only the acquired empty lock with `rmdir`.

- [ ] **Step 4: Verify merge CI and campaign state**

Record the PR URL, squash merge SHA and the main CI run naming that SHA. Mark D1 landed in Lane D's queue, append all receipts to `progress.log`, and verify local and remote feature branches plus the registered worktree are gone.
