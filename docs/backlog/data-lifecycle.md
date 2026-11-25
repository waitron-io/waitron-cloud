# Data lifecycle

The [venue lifecycle journal](../data-lifecycle-journal.md) records fixed cancellation
deadlines, worker claims and uncertain effects. When test Backups offers downloads,
it reads the journal's deadline for the verified archive, key and manifest. The disposable
rehearsal records when service ends. Full exit, resubscription and all-copy purge
stay open. Local capture, retention, verification, recovery, key rotation
and history cleanup are implemented ([proof](../local-backups.md),
[captures](../authenticated-captures.md), [containment](../backup-verifier-containment.md),
[recovery code keys](../recovery-code-keys.md)).

**Decisions and limits.** Daily retention is 30 days and monthly 12 months, with daily timing at
the venue's business-day cutover. The last verified snapshot is protected from automatic expiry
while the backup subscription is active. An ordinary backup download does not satisfy a future
hosted target with an external application-vault key: that stays blocked on
`external-vault-archive-v2` and explicit on-premises re-encryption. Give each worker a distinct
owner. Restore verification stays separate from upload freshness, and completion reports from
activation.

**Open:**

- **Year-sized backups.** Keep the test Cloud's 512 MiB limit until a genuine year-sized backup
  passes capture, retained verification, preview and staging. Use Lane M's trimmed 3.31 GB
  synthetic database, about 1 GB compressed, and ask Lane I for private transfer into one isolated
  55-minute Linux slot (an estimate). At the measured growth a venue reaches the 4 GiB expanded
  limit after about 15–16 months; Cloud then reports capture failure and keeps the last copy.
  `backup.verifier_resource` refused the 269 MB and 368 MB test archives; Waitron's
  `compareBackupTables` sorting is a possible cause (Lane J's VERIFIER-MEMORY).
- **Fiscal verification** waits for Lane L's VERIFIER-CERT-OPEN: the certificate opener needs a
  subprocess and the verifier denies them (`secret_unavailable`). Rerun the paired fixture then.
- **Deployment measurements:** uplink bandwidth, spool volume, shutdown latency during copy and
  encryption, provider policies, transfer interruption, expiry and cancellation at scale, worker
  counts and scheduling for the real venue distribution. The
  [capacity guide](../local-backups.md#measure-local-transfer-capacity) records local numbers.
- **Custody and isolation:** production master-key custody and rewrapping, dynamic writer/reader
  credential delivery, rotation and revocation (static or renewable), a journey that applies
  Cloud's stream settings on the source box without showing credentials to the browser, alerts
  for missing stream observations, the provider's prefix and conditional-write
  semantics, production host/kernel verifier hardening, hostile exploits and fleet sizing.
  Qualify untrusted diagnostic forwarding before widening the trusted-local adapter.
- **Policies:** production cutoffs, recovery-request and audit retention, account deletion,
  explicit deletion and cancellation, what survives subscription termination and for how long,
  longer paid retention for selected snapshots, and storage costs before pricing. Validate the
  hourly stream snapshot and 30-day stream retention baseline. Treat recovery guess limits as an
  ingress and request-reissue decision, not a reason to raise the allowance. Planned final-write
  handover comes before activation. Define the external-key format extension.

**Unexplained failures.** Keep every assertion, ownership rule, removal policy and deadline.

- Process-verifier CPU case: `backup.verifier_timeout` instead of `backup.verifier_resource` in a
  full local run (21 October). Capture child CPU, resource-signal delivery and close timing.
- Container-worker verdict: [CI run 36702956368](https://github.com/waitron-io/waitron-cloud/actions/runs/36702956368/attempts/1)
  expected a failed archive check and found it pending. Use the outcome and queued-job state on the
  next natural failure.
- Reclamation tests over their 13-second checks (14.57 and 14.82 seconds): capture image
  inspection, enumeration, removal, verification and host scheduling.
- The heap-refusal crash-collection (run 39111146785), container start and image-build timings
  behind older CI failures are unproved. Shared-daemon loss during cleanup, host crashes and production recovery
  timings are unmeasured.
