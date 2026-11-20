# D621 run 9 PR 13 | Restart all three Stockholm machines

After the three measured stops, keep the same outside venue running while all three
machines stop together. Confirm the outage from outside. Restart those exact machines
with their disks intact, then verify that the same clients reconnect, previously
acknowledged data survives, and a new write, backup and isolated restore succeed.
[Sizing row 13](2026-11-18-d621-run9-sizing.md) ·
[Run 9 decision](2026-11-18-d621-run9-qualification.md)

## Bound the restart and prove which machines returned

- Extend `measured-stops` in `scripts/amazon-run.mjs`. Keep the single-stop deadline
  20 minutes before scheduled deletion, and let the same venue run through cold
  recovery for at most 20 minutes and only until minute 145. Allow the final five
  minutes for deletion confirmation. Refuse to start a cold stop without its reserve.
- Record the owned instance IDs, attached volumes and boot IDs. Stop the three in
  one request and confirm every exact ID is stopped before the outside probes run.
  Start the same IDs together after the outage is observed. Reuse single-node SSH
  and tunnel endpoint refresh. Verify private addresses, retained volumes, changed
  boot IDs, fresh node heartbeats and control-plane readiness.
- Add `ec2:StartInstances` to `deploy/kubernetes/bounded-amazon/setup/launcher-policy.json`
  with the same account, region and D618 tag scope as the stop grant. Preserve the
  existing scheduled and immediate failure cleanup, including after a denied start.
- Reuse verifier scratch preparation in `deploy/kubernetes/bounded-amazon/bootstrap.sh`
  at boot before kubelet can use the bind mount. Preserve the disk, 1 GiB limit and
  UID/GID 1000. Verify retained files and required mounts after boot. Keep B and C
  independent of A's staging share.
- In `scripts/amazon-run.test.mjs`, first fail cases for the separate deadline, exact
  stop/start ordering, retained disks and refreshed addresses, scoped policy and
  cleanup on refusal or cancellation. In `bootstrap.test.mjs`, first fail a case for
  reusing the scratch disk and requiring the mount before kubelet. Make both pass.

## Prove cold recovery using the existing outside clients

- Wire the existing Kind restart through `scripts/kubernetes-node-loss.mjs` and
  `scripts/kubernetes-check.mjs`. Keep the standalone restart and its cluster identity
  checks. Give the services journey the same lifecycle with an outside probe while
  all nodes are off and mesh reconnection after they start.
- In `scripts/kubernetes-services.mjs`, require an observed transport outage from the
  previously working outside clients before start. Reuse the SQL witness in
  `scripts/kubernetes-cold-restart.mjs` for the acknowledged row and new write.
  Require one writable primary and a ready store before testing the backup.
- Reuse the session, route and backup checks at the handoff in
  `scripts/test-cloud-integration.mjs` and
  `deploy/test-cloud/test-fixtures/integration-paid-remote.mjs`. Keep the browser,
  venue and tunnel alive until the cold phase ends. Verify the original backup and a
  distinct capture with a new isolated restore. Record outage and recovery times
  separately from the three existing single-stop bounds.
- First fail focused cases in `kubernetes-node-loss.test.mjs` for lifecycle reuse, in
  `kubernetes-services.test.mjs` for a real outage and complete recovery evidence, and
  in `test-cloud-integration.test.mjs` and `test-cloud-paid-remote.test.mjs` for retained
  clients, original backup, fresh restore and preserved route checks. Make them pass
  alongside `kubernetes-cold-restart.test.mjs` and workspace typecheck.

Extend the existing outside test in `scripts/kubernetes-services.test.mjs` for a
cold-only disposable Linux rehearsal with one venue and verified cleanup. Update the
AWS guide, D618 account setup, sizing and backlog. Estimate 330–470 implementation
and 240–340 test lines. Keep real provider setup, the combined final-tree timed dry
run, billing reconciliation and paid qualification as separate gates. The earlier
staff-certificate failure and backup worker exit remain open.
