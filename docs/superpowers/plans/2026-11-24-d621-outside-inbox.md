# Keep the D621 test inbox outside the three machines

The outside rehearsal keeps already delivered mail readable during machine
loss. The 24 November Kind diagnostic located a sent message only in the inbox
on the database primary. Stockholm did not record which inbox received its mail.

1. Start one owned Mailpit v1.31.1 in `kubernetes-outside.mjs` after creating
   the run credentials and before starting the service pods. Inspect the image
   ID and in Kind pull only if absent and remove only if pulled. Publish
   authenticated TLS SMTP on WireGuard address `10.77.0.4` and the
   authenticated inbox API on loopback. Extend the exact-port allowlist and
   share the Git mirror's peer filter and listener cleanup in
   `kubernetes-git.mjs`. Close both independently, keeping each peer filter
   until its listener is gone. Retain bounded failure logs.
2. Use the outside endpoint only in the DaemonSet, with an IP certificate and
   the Kubernetes node name as the SMTP username. Use the existing loopback
   inbox fetch in `test-cloud-integration.mjs`. Remove `inboxRequest`,
   `readServicesInbox` and the three tests of the per-pod reader. Keep the
   inbox HTTP 401 check, and list the removals and binding change under
   “Changed test checks”. Save a Mailpit `ID` before each stop and read
   `message/<ID>` while the machine is down and after the full restart. Log
   the authenticated username beside the Message-ID in sign-in confirmation
   events. Fresh post-stop signup must name a surviving worker. Update the
   AWS rehearsal guide and backlog with what each sign-in or signup proves.
3. Test the change to the DaemonSet in `deploy/kubernetes/services.test.mjs`
   while keeping the one-node Mailpit check. Test carrying and missing SMTP
   usernames in `test-cloud-integration.test.mjs`. Test that the stopped
   machine cannot count as the sender in `kubernetes-services.test.mjs`.
   Test the SMTP port rule in `amazon-run.test.mjs` and the inbox ports,
   bindings and failed start in `kubernetes-git.test.mjs`. Keep shared
   filter and cleanup failure cases with the Git mirror. Exercise the TLS
   and authentication refusals from all three pods and retained mail through
   all three stops and the full restart in the free Kind rehearsal.

Budget about 120 net lines of code and 120 of tests. The watcher cleared this
test-only scope at 15:48 on 24 November. Done when the pull request is open
after the passing Kind run. The separate worker investigation owns restart
delay. The production mail path and the 90-second target stay as specified in
the [D621 service-recovery plan](2026-11-20-d621-stockholm-service-recovery.md).
