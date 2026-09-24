# Scheduled snapshots implementation plan

Execute inline with TDD, then finish and land both repositories autonomously.
Spec: ../specs/2026-09-24-scheduled-captures-design.md.

1. Waitron: introduce durable single-capture storage and a serial tick worker. Write
   real filesystem tests first for restart/lost replies, schedule and retention, expiry,
   binding, revocation and failure containment. Reuse nextFireMs.
2. Waitron: assemble production snapshots using the existing archive machinery, stream
   encrypted files for upload and bind the worker to boot/shutdown. Test its real archive,
   HTTPS upload/refusal/cancellation and lifecycle paths, including a throttled transfer.
3. Cloud: drive the scheduled worker through the existing local backup integration
   fixture; retain the real restore proof and add interrupted-delivery/restart assertions.
   Update both backlogs and the delivery runbook with the tested limits.
4. Finish each branch with focused checks, one isolated Claude run-it review where
   production code changes, normal push hooks and exact-head CI. Land and clean up.

Review focus: crash windows around atomic files, lost publication responses after expiry,
reuse of bytes/key versions, installation rebinding, role changes during a wait, local
storage bounds, shutdown versus outage, and whether boot actually invokes the worker.
