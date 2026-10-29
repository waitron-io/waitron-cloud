# Data lifecycle

The internal managed-backup catalogue now protects the latest
successfully verified snapshot (or newest snapshot when none has verified) and active
recoveries, with automatic operation expiry, resumable deletion and
30-day daily/12-month monthly expiry. PostgreSQL tests cover failures and races.
Versioned managed keys and bound owner recovery are implemented for local test venues;
[the real snapshot proof](../local-backups.md) runs Waitron validation and restore hooks.
The local worker now schedules real restore verification, retention and abandoned-upload
cleanup with durable claims, lease fences and bounded retries. Captures expire after
24 hours; cleanup waits another 16 minutes and keeps tombstones. PostgreSQL tests cover
concurrent workers, lease takeover and restart; the two-server proof uses this queue.
The [authenticated capture adapter](../authenticated-captures.md) now uses bound installation proofs,
scoped upload grants and authority checks after storage waits. Waitron now schedules daily
captures, assigns monthly retention to the first successful capture of each venue-local
month and persists one encrypted archive for exact retries across restart. The file
uploader streams with a 14-minute/credential-expiry deadline and bounded retry backoff;
deliberate shutdown is not an outage. The local proof crashes after upload and restores
the resumed snapshot without recapture. Cloud now stages provider downloads to private files
while hashing and length-checking them, reopens the immutable stage for conditional upload
retries, and streams verification into the isolated Waitron restore process. A 32 MiB local
SeaweedFS fixture on an Apple M5 Pro observed 5,975,936 bytes of peak ArrayBuffer growth and
26,968,064 bytes of RSS growth. Archive assembly in Waitron still uses its existing format and
the end-to-end 512 MiB archive limit remains unchanged. Confirmed uploads retry publication without resending; loss of an
acknowledged storage object waits until capture expiry before recapture. A reproducible
4 MiB controlled-HTTPS receipt now measures throttled upload/download retries, 120 ms
deadline cancellation, partial-stage cleanup, missing objects, one-copy publication replay,
credential renewal with one durable archive and shutdown through a controlled Waitron archive
wait. Cloud download cancellation now releases its durable verification claim without recording
failure or consuming a retry. These are local boundary measurements, not production timeout or
bandwidth targets. The capacity fixture adds a disk-backed two-venue TLS profile
at 32, 128 and 512 MiB per venue, with signed credential isolation, interrupted retries,
digest/length checks, cancellation and exact fixture cleanup. Its version 2 receipt
records per-size resource preflights/skips, transfer times and sampled process memory
and scratch/disk peaks. CI exercises the boundary cases at 1 MiB; larger runs stay
explicit. See [the capacity guide](../local-backups.md#measure-local-transfer-capacity).
The [clean-commit measurement](../receipts/backup-capacity-2026-09-30.json) ran all three
sizes; the guide records the observed times and resource peaks. Provider policies
and real Waitron archive assembly remain outside this fixture.
Next: measure deployment uplink bandwidth, spool volume and real database/
encryption shutdown latency, stream Waitron archive assembly/restoration before reconsidering the current 512 MiB bound,
production master-key custody/rewrapping and production-host verifier hardening. The
process verifier denies network, subprocesses, native addons, host reads and outside
writes. The container adapter adds a disposable container around the deployed
verifier with total memory, swap disabled, aggregate scratch, no network or host mounts, and ownership cleanup.
Archive input now waits until Docker inspection acknowledges runtime startup.
A local Docker 28.0.4 runtime with a controlled two-second start-return delay
reproduced exit 73 with `OOMKilled=false`: restore input arrived before
containerd installed its OOM watcher. Later inspection did not repair the flag.
Waiting before streaming passes the same controlled native-memory, scratch
and subsequent valid-restore sequence without changing a containment assertion
or deadline. This establishes and fixes that startup mechanism; the original
Ubuntu failure did not record its start stages, so its exact trigger remains
unproved. Gated real-Docker tests keep the archive unopened through startup
and cancellation at the start and refusal-inspection boundaries. Diagnostics
precede the strict resource assertions so a future failure retains its cause.
Real Docker fixtures exhaust native memory (192 MiB) and scratch (16 MiB); the parent
survives and verifies later work. Two real Waitron snapshots at revision
`00496fcd182a5c2c9189cc3faf0f8f22d3baf8ac` restore with 1024 MiB memory and 256 MiB scratch.
See [the containment receipt and limits](../backup-verifier-containment.md).
Both container-verifier and database-worker image preparation have a separate
150-second setup budget around their 120-second Docker command limit; individual
test deadlines and containment assertions stay unchanged. A controlled 31-second
build delay reproduces the former setup timeout. Separate CI jobs give each file
a fresh Docker build cache. The database-worker CI case reached its 30-second
deadline, but did not record the build duration separately. The same controlled
build delay now passes its unchanged 30-second worker test after image preparation
moves into the setup hook; the historical CI stage timings remain unproved.
The process adapter stops and reaps a child when V8 reports fatal heap exhaustion,
before kernel crash collection can replace that resource refusal with a watchdog timeout.
[Synthetic Ubuntu tracing](https://github.com/waitron-io/waitron-cloud/actions/runs/39111778828)
observed the heap report at 75–372 ms, then concurrent children waiting in crash-dump
pipe writes until all eight reached the unchanged five-second watchdog.
[A controlled eight-second core collector](https://github.com/waitron-io/waitron-cloud/actions/runs/39111842785)
reproduces the original strict heap test's resource-versus-timeout failure. New tests
pause a genuinely exhausted child, split the fatal report across chunks and preserve
ordinary stderr outcomes. The [same controlled collector with the fix](https://github.com/waitron-io/waitron-cloud/actions/runs/39111967260)
passes the unchanged heap assertion. The original nine process tests, heap limit, permissions,
output bound and deadlines remain unchanged. The earlier main failure
[39111146785](https://github.com/waitron-io/waitron-cloud/actions/runs/39111146785)
did not capture child stages, so its precise historical crash-collection timing remains unproved.
The fatal marker remains advisory: printing a matching line stops even a child
that would otherwise return valid JSON. Qualify untrusted diagnostic forwarding
before expanding this trusted-local-archive adapter's scope. The reviewer also
measured about 0.2–0.6 seconds of extra parent CPU for 40,000 one-byte stderr
writes from rescanning the accumulated text. The detector now reads each new
chunk once and retains at most 18 characters for a heap phrase split across
chunks. A real-child fixture delivers 40,000 stderr bytes one at a time and
bounds the text scanned, while separate cases retain the line-start anchor,
split phrases, case handling and carriage-return/newline boundaries. The original
process checks, combined 64 KiB output limit and failure ordering remain.
The scanning fixtures now consume their private input before emitting diagnostics
and exiting. A paused parent reproduces a closed-input-pipe refusal with the old
fixtures; the same unchanged scan bounds, heap classifications and line-boundary
checks pass once input finishes first. Normal and paused-parent cases remain in
`packages/backups/test/verify-process-scanning.test.ts`. The historical CI refusal
has no child pipe timings, so its precise ordering remains unproved.
**Open: process-verifier CPU refusal timing.** A local 205-case backup run on
21 October passed 204 cases but the one-second CPU-limit case returned
`backup.verifier_timeout` at its unchanged five-second wall deadline instead of
`backup.verifier_resource`. The isolated original case passed in 1,015 ms.
Neither the process adapter nor its test differs from the current main revision
in this gateway batching branch. The full-run failure remains unexplained;
an isolated pass does not establish a correction. Capture child CPU usage,
resource-signal delivery and process-close timing on recurrence before changing
the resource refusal, permissions, assertions or deadlines. Local evidence is
`~/waitron-campaign-d/receipts/d98/resume-approved/backups.log` and
`cpu-isolated.log` in the same directory.
Production host/kernel isolation, hostile native exploits, fleet sizing and large archives remain
unverified; the process-only development adapter still lacks these total-resource bounds.
The verifier distinguishes bounded infrastructure failures from archive verdicts:
failed staging, Docker start/connection, cleanup and verifier protocol errors preserve the prior snapshot
state and retry with `verification_unavailable`. A real local PostgreSQL stop/restart,
worker-only Docker connection outage, start refusal and two-organisation valid/invalid
recovery tests pass. Eight-attempt exhaustion, explicit retry, cancellation, lease fencing
and verified fallback protection remain covered. See the containment guide for the exact
executed cases; shared-daemon loss during active cleanup, physical host crashes and
production recovery timings remain unmeasured.
**Open: intermittent container-worker verdict.** [CI run 36702956368, attempt 1](https://github.com/waitron-io/waitron-cloud/actions/runs/36702956368/attempts/1)
expected a failed archive check but found it pending. Its cause remains unresolved:
local and Ubuntu probes have not reproduced it. [PR #99](https://github.com/waitron-io/waitron-cloud/pull/99)
adds verifier outcome, fixed Docker failure details and queued-job state to the
unchanged test assertion; a controlled start-refusal experiment reports
created state, attach exit 125 and `verification_unavailable`. This is diagnostic
coverage, not a fix. The temporary stress workflow is removed. On the next natural
failure, use those details to identify the failing boundary, reproduce it and fix
its cause while preserving the distinction between infrastructure uncertainty
and an invalid archive. Passing probes do not close this defect.
**Concurrent reclamation tolerates an already removed container.**
Deterministic Docker fixtures remove a listed container before inspection or
removal; a missing result during active verification still raises infrastructure
failure. Exit 1 with the exact missing-object/container diagnostic naming that
ID is tolerated. Reclamation retries an exact removal-in-progress diagnostic
within one ten-second removal budget, refusing a removal that never finishes.
Daemon errors, another ID and a different exit code remain
failures; raw daemon text is not exposed. The existing deadline and foreign-owner
test passes unchanged. Shared-owner and isolated-owner lifecycle probes each
complete 12 calls, with four successful restores and eight expected resource
refusals. Three further rounds with ten expired containers and two reclaimers
each finish without errors. This fixes the concurrent reclamation failure; it
does not resolve the sequential worker-test failure above. Continue assigning distinct worker owners;
these local probes do not establish production concurrency capacity.
Two unchanged reclamation tests later exceeded their 13-second whole-operation
checks in a full local backup run, at 14.57 and 14.82 seconds. Isolated tracing
completed them in 2.17 and 10.84 seconds. Adding 11.5 seconds to container creation
or 3.2 seconds to image inspection reproduces the respective elapsed-time
failures without changing the ten-second removal budget. The original run
overlapped root checks and review controls but retained no per-command timings,
so its exact cause remains unproved. Capture image inspection, enumeration,
removal, verification and host scheduling on recurrence. Keep the 13-second
checks, 15-second test deadlines and removal policy intact; passing repeats
do not resolve this timing defect.
A read-only
dependency inventory and local drill now prove active-key rotation, old snapshot restore,
worker restart and wrong/missing-key refusal without exposing secrets or deleting keys.
The history cleanup command
now removes completed jobs and already-deleted tombstone metadata in bounded chunks
after exact operator cutoffs; pending/running/failed jobs, current points, protected
snapshots and recovery references remain. Choose the production cutoffs before use.
A reproducible 1,000-venue local fixture now measures scheduling separately from job
polling. It reduced 1,000 repeated empty backup sweeps from 3,602 ms to one 5 ms cadence
sweep while preserving the 100-row query bound. Repeat this with the selected database
topology and deployment-sized venue distribution before setting worker counts or
scheduling objectives.
The local two-venue proof now exercises Waitron's stream, sealed recovery kit and
cold-restore contracts. Production still needs dynamic writer/reader credential
delivery, rotation and revocation; the selected provider's prefix and conditional
write semantics; measured continuous retention; monitoring and scheduling; and the
planned final-write handover before activation.
Retention, restore checks, export, deletion and access review;
define what survives subscription termination and for how long.
The catalogue implements daily retention for 30 days and monthly retention for 12 months.
Longer paid retention for selected snapshots remains to be implemented. Daily timing follows the venue business-day cutover with stable jitter; the first successful
capture per local month gets monthly retention, and missed runs make one current copy.
Validate storage costs before pricing.
Validate the inherited continuous-backup retention baseline. Protect the last verified snapshot from automatic
expiry while the backup subscription is active. PostgreSQL tests already prove
failed verification preserves the verified fallback and cleanup resumes after
storage deletion fails, including concurrent cleanup. Run the focused cases in
`packages/backups/test/worker.test.ts` and `catalogue.test.ts`; repeat these
failure boundaries against the selected provider. Explicit deletion and
cancellation policies remain open.
Carry forward the existing topology's proposed hourly stream snapshots and 30-day
stream retention as a baseline to validate. Productionise the implemented internal Cloud-managed recovery-key
custody and authorised delivery, respecting the existing external vault-key design.
The local integration now uses the contract's mapped backup contents, manifests,
module restore hooks and per-secret handling against the landed SQLite interfaces;
repeat those boundaries with the selected provider.
The local key drill and two-venue recovery proof test rotation with retained snapshots
and recovery after loss of the original server without an owner-held backup key. See the
[existing-design reconciliation](../documentation-ownership.md#backup-and-recovery-design-reconciliation).
The version 3 recovery-boundary receipt now proves the landed consumers rather than
the older proposed identity split: both stream and archive restore recover the source
local node ID and run Waitron's restore hooks, while replacement registers a distinct
Cloud installation with fresh machine authority. It restores an older key-version
snapshot after rotation, restores the separate application vault state byte for byte,
and inherits no backup destination, Cloud credential or staff TLS material.
`BackupManifest` v1 needs no change for this managed path. A future hosted target with
an external application-vault key remains blocked on the named
`external-vault-archive-v2` compatibility contract and explicit on-premises re-encryption;
an ordinary backup download does not satisfy either requirement.
Owner-approved recovery and replacement now append immutable customer audit events and
current owners can export them in stable pages. Before production, choose the
recovery-request/result cutoff, audit retention and account-deletion handling. Closed
expired recovery history now has a separate cleanup category that
preserves active operations and incomplete replacements. A bounded two-instance run admitted exactly 10 of 12 concurrent fresh-key
recovery starts behind one address. Guesses using unrelated UUIDs left the target's
budget untouched; five concurrent wrong codes against a known UUID serialized to five,
closed the pending request and refused its later correct code. Treat that availability
cost as an ingress/request-reissue decision, not a reason to raise the guess allowance
blindly. Recovery codes now use a separate external key, as described in
[the upgrade and rotation instructions](../recovery-code-keys.md).
Keep completion reports separate from activation, and test deployment-scale transfer
interruption, expiry and cancellation against the selected provider. Restore verification is
separate from upload freshness; production workers still need enforceable resource and
network isolation, without activating a primary or contacting fiscal/payment services. Define the external-key format extension
rather than assuming it exists in the inspected manifest v1.
