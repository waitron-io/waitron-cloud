# Keep the D621 test inbox outside the three machines

The outside rehearsal can still read mail it received before a cell machine
stops. The 24 November free diagnostic matched a sent Message-ID to Mailpit on
the database primary. Both surviving inboxes answered after the stop and neither
had it. That confirmed the mechanism in Kind using historical Cloud `4a39665c`
and a minimal image. Stockholm kept no inbox placement for its first message.

1. In `scripts/kubernetes-outside.mjs`, start one owned Mailpit container on the
   launch host after `configureServices` creates the run credentials and before
   the service pods start. Reuse Mailpit v1.31.1 and its synthetic-recipient
   restriction. Publish authenticated TLS SMTP only on WireGuard address
   `10.77.0.4` and the authenticated inbox API only on loopback. Extend the
   exact-port allowlist and reuse the Git mirror's Docker peer filter in
   `scripts/kubernetes-git.mjs`. Use the resolved Mailpit image ID. Close the
   mirror and inbox independently. Keep each Docker filter until its listener is
   absent, and retain bounded failure logs before cleanup.
2. In `deploy/kubernetes/services.mjs` and `scripts/kubernetes-services.mjs`, send
   outside mail to that endpoint with a certificate covering its IP. Give each
   worker its Kubernetes node name as its SMTP username. Mailpit already returns
   the authenticated `Username` for a message. In `scripts/test-cloud-integration.mjs`,
   use it as sender evidence for fresh signup mail requested after stop. Require
   that sender to be in the surviving set. Replace the per-pod inbox reader with
   the host API. Keep the one-node check's loopback inbox. The existing sign-in
   journey can finish a challenge issued before the stop. Fresh signup measures
   new sending after the stop. Record that difference and the new inbox read path
   in `docs/aws-infrastructure.md` and the D621 entry in `docs/backlog.md`.
3. Write the failing manifest check first in `deploy/kubernetes/services.test.mjs`.
   Outside workers should use the shared endpoint without a Mailpit sidecar. The
   one-node services should still use their local inbox. In
   `scripts/kubernetes-services.test.mjs` and `scripts/test-cloud-integration.test.mjs`,
   prove sender identity on fresh signup and refuse a stopped or unknown sender.
   In `scripts/amazon-run.test.mjs` and `scripts/kubernetes-git.test.mjs`, cover the
   two port rules, non-peer refusal and independent cleanup on failed start or
   close. Use the existing TLS and authentication refusals from all three email
   pods to exercise their private route. In the disposable outside Kind run,
   check that already visible Message-IDs stay readable through each stop and
   the all-machine restart. Keep the existing sign-in and signup checks.

Budget about 120 net lines of code and 120 of tests. Reuse the running outside
journey and its fault harness. This addresses test capture. The worker restart
delay has its own investigation. The 90-second target and the production mail
path stay as specified in the [D621 service-recovery plan](2026-11-20-d621-stockholm-service-recovery.md).
A passing Kind run supplies local evidence for the watcher.
