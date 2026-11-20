# D621 run 9 PR 13 | Restart all three Stockholm machines

After the measured single stops, keep the same outside venue while all three machines stop
together. Confirm the outage, restart the exact machines and disks, and show that the same
clients reconnect, read acknowledged data and complete a new write, backup and isolated restore.
The watcher assigned this slice on 20 November at 21:10 in Lane G's `questions.md`.
[Sizing row 13](2026-11-18-d621-run9-sizing.md) · [Run 9 decision](2026-11-18-d621-run9-qualification.md)

## Stop, restart and confirm the machines

- In `scripts/amazon-run.mjs`, extend `measured-stops`. Keep the venue, tunnel and observer
  under a run deadline distinct from the single-stop deadline. Only single-stop work uses
  the latter. Reserve 20 minutes of the 145 before deletion. Aim for 4 minutes to confirm
  the stop and outage, 5 to start and reach a live API, 4 for data readiness and 5 for
  client checks and restore. Finish by minute 143 with two minutes to spare. Enforce
  the deadline on commands. Refuse a late stop and delete on failure or cancellation.
  Record individual stop and boot times to compare against the estimate.
- Save the exact stack's instance IDs, volumes and boot IDs. Stop all three without
  OS shutdown in one request. Confirm all three are stopped, prove the outage, then
  start the same IDs in one request. Read all new addresses together, refresh the
  existing SSH and tunnel routes and verify instance identity through the metadata
  service. Check retained volumes and private addresses, changed boot IDs, fresh node
  leases and API readiness before checking services.
- Add the missing start permission in `deploy/kubernetes/bounded-amazon/setup/launcher-policy.json`
  under the existing account, region and D618 tag scope. The guide has the owner verify
  stop and start for tagged instances and refusal outside that scope before launch.
  Instance IDs are assigned at launch. All launcher calls use only the exact stack's
  instances. Independent expiry and failure deletion retain their existing authority.
- In `deploy/kubernetes/bounded-amazon/bootstrap.sh`, reuse the verifier scratch setup
  at boot and require its mounts before kubelet. Preserve the existing disk, 1 GiB limit
  and UID/GID 1000. Check retained files and required mounts. Keep B/C's staging share released.
- First fail `scripts/amazon-run.test.mjs` cases for a live venue past the single-stop
  cutoff, bounded cold commands, exact IDs and ordering, refreshed addresses and disks,
  policy scope and cleanup on start denial or cancellation. First fail
  `deploy/kubernetes/bounded-amazon/bootstrap.test.mjs` for mounting the existing disk
  before kubelet. Make both pass with mocked provider and boot commands.

## Reuse the outside journey

- Wire the existing Kind restart through `scripts/kubernetes-node-loss.mjs` and
  `scripts/kubernetes-check.mjs` into the existing measured services journey. Keep its
  standalone identity checks. Restore the mesh after boot. Exercise the full sequence
  on one disposable Linux venue with verified cleanup. Keep the shortened local holds
  and do a final timed dry run separately on the landed tree.
- In `scripts/kubernetes-services.mjs`, require the same account, store, staff and public
  probes to work before the stop and show fresh transport failure while all are off.
  Confirm the outside observer can still reach the machine control path while probing.
  Reuse `scripts/kubernetes-cold-restart.mjs` for a retained SQL row and new write, with
  one writable primary and ready storage. Keep separate cold timings.
- At the existing probe handoff in `scripts/test-cloud-integration.mjs` and
  `deploy/test-cloud/test-fixtures/integration-paid-remote.mjs`, keep the original
  session, venue process and tunnel. Read back the last acknowledged venue capture
  after recovery, verify a distinct capture and new isolated restore, and retain
  the signed-route and response checks. Keep the existing single-stop bounds.
- First fail the lifecycle case in `kubernetes-node-loss.test.mjs`, outage and recovery
  evidence in `kubernetes-services.test.mjs`, and retained clients and backup/route
  evidence in `test-cloud-integration.test.mjs`. Run these and
  `kubernetes-cold-restart.test.mjs` by name, then run workspace typecheck.

Update the AWS guide, D618 account setup, sizing and backlog. Estimate 330–470
implementation and 240–340 test lines. Local timing cannot establish Amazon boot time.
Final-tree timing, billing and the paid proof remain launch gates. The staff-certificate
failure and earlier backup worker exit remain open.
