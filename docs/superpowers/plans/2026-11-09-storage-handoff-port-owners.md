# D506 storage handoff port owners

Authority: `/Users/clintongormley/waitron-campaign-g/queue.md` and `questions.md`, watcher **2026-11-09 12:52**: “D506 (the recurring port-collision flake) first ... D506’s fix goes test-first from a failure that prints the port’s holder.”

Driver reviews and commits this plan, obtains one Claude read, then asks watcher approval before building. No standalone plan PR.

Reading evidence: `scripts/backup-storage-fixture.mjs:346,408,632–646` selects odd ports, releases reservations before spawn, and attaches LISTEN-only ownership without printing it. `/Users/clintongormley/waitron-campaign-g/receipts/d616/build-20261109/head-ci/job-129106638540.log:7555` names master port 35921 without its holder. Automatic outgoing-port overlap is untested; historical owners remain unexplained.

Files to change:

- `scripts/backup-storage-fixture.mjs`: diagnostics, then only the demonstrated allocation repair.
- `scripts/ci-backup-storage-startup-diagnostics.test.mjs` (new): real-owner diagnostics and cause-specific regression.
- `scripts/ci-backup-storage-readiness-diagnostics.test.mjs`: deliberately extend exact output checks for the added marker; retain original readiness bytes, counts and error identity.
- `deploy/test-cloud/storage-startup.test.mjs`: cause-specific native regression if needed; retain every check.
- `docs/backlog.md`: own D506 paragraph only.
- `docs/backlog/storage-cache-fixture.md`: own D506 section only.
- `docs/superpowers/plans/2026-11-09-storage-handoff-port-owners.md`: this plan.

- [ ] **Diagnostics first, test first.** Add subprocess controls with a real competing listener and a connected TCP owner. Capture actual stderr; require one `storage_startup_failure=` JSON marker per failed native startup before cleanup, including the first attempt when retry succeeds. Watch these fail because output is missing. Add missing-inspector, no-owner and throwing-sink controls; verify original error identity, cleanup and preservation of competing sockets. Include synthetic private values and assert they never print.
- [ ] Reuse `storageStartup` and its existing two-second, 65536-byte collection bounds. Include listening and connected sockets, allocated ports, PID and process short name. Emit only credential-free fields, never arguments, environment or raw error text. Distinguish collection unavailable from no observed owner. Include fixture root identity only when existing claim/root mapping demonstrably identifies that holder; a claimant alone is insufficient. Preserve all eight claims, odd preference, exactly one retry, cleanup and broken-reporter handling. Make controls pass.
- [ ] Trace these consumers before changing policy, then run them explicitly:

```sh
node --test scripts/ci-backup-storage-claim-before-bind.test.mjs scripts/ci-backup-storage-reservation-refusals.test.mjs scripts/ci-storage-admin-handoff.test.mjs
node --test deploy/test-cloud/storage-startup.test.mjs deploy/test-cloud/storage-admin-ports.test.mjs deploy/test-cloud/storage-admin-exhaustion.test.mjs deploy/test-cloud/storage-s3-grpc.test.mjs
node --test scripts/ci-backup-storage-readiness-diagnostics.test.mjs
```

- [ ] On the Linux test-box, use controlled/concurrent native handoffs to capture the holder before cleanup. Inspect the actual automatic outgoing range if implicated. Reproduce the evidenced conflict in a failing regression, then minimally repair this fixture and rerun that reproduction and commands above. Never choose an arbitrary range. Stop with evidence for watcher if diagnostics cannot establish cause or repair requires a new reservation scheme. The readiness diagnostic checks deliberately gain the startup marker while retaining the exact readiness record and all original predicates. Ask before any other changed check or file.
- [ ] Update D506 documentation with commands, observations and remaining limits. No new protocols, deadlines, permanent self-mutation tests, retry increases, unrelated progress-timeout repair or production/provider changes. CI owns full suites. After build: one Claude run-it review, one gathered push, inspect every exact-head CI job, then signed landing under your own lock and exact-merge verification.

Estimate: 60 production lines, 220 new/40 changed test lines, 40 documentation lines and 60 plan lines: 420 changed lines total; stop for watcher at 630. Three-hour start-to-PR budget; approval waits excluded. No extra deadline.

Finish: unrelated Cloud CI no longer hits the reproduced allocation conflict; remaining real refusals print their current owner without hiding the original failure. Without an established cause, D506 is incomplete.
