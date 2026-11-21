# D621 run 9 decision

**Owner decision.** On 18 November 2026 at 10:11, the owner selected “Approve run 9 now (Recommended)” in the watcher’s decision prompt. The approval covers one Stockholm run of up to 150 minutes and about $2.25, including deletion confirmation. Start only after the build has landed and passed its checks, the timed dry run passes, and spending is reconciled with the $10 deny-launch backstop in place.

**Before launch.** Run 8 stopped only machine C. Machine A hosted the control plane, database, storage and observer. For run 9, keep the observer and venue on the private test host outside the cell. Verify routing after machine addresses change, scope the rehearsal firewall to the test host, and check production-mode mail delivery to the private sink. Verify the schedule fits the approved expiry. The owner applies the reviewed setup and grants restart permission for the three instances. Follow the [readiness sizing](2026-11-18-d621-run9-sizing.md).

**Run 9 result.** The paid attempt used the old in-cluster journey and failed at pairing. The owner confirmed the stack was gone. The HTTP 503 and manifest restarts remain unexplained. Cloud pairing changed between the passing local rehearsal and the paid run. Any repeat needs separate owner approval and a fresh passing outside rehearsal on the exact Cloud commit and Waitron image you plan to use.

With those images loaded, run the outside rehearsal on disposable Linux. Retain the Cloud commit and Waitron image ID with the result. Follow the [outside rehearsal setup](../../aws-infrastructure.md#rehearse-the-full-service-journey-from-outside-the-cell).

```sh
git rev-parse HEAD
TEST_KUBERNETES_OUTSIDE_BASELINE=1 TEST_KUBERNETES_OUTSIDE_SERVICE_STOPS=1 node --test --test-name-pattern='one outside Linux venue' scripts/kubernetes-services.test.mjs
```

After the Linux rehearsal passes, save its Waitron image to a private path outside the checkout and record the archive's SHA-256 checksum with the result. Give it a rehearsal tag so it stays loaded when the launcher removes its own temporary tag.

```sh
umask 077
docker tag "$TEST_CLOUD_INTEGRATION_WAITRON_IMAGE" "$WAITRON_REHEARSAL_TAG"
docker save --output "$WAITRON_REHEARSAL_ARCHIVE" "$WAITRON_REHEARSAL_TAG"
sha256sum "$WAITRON_REHEARSAL_ARCHIVE"
```

For a separately approved paid run, verify that checksum on the test host. Load the archive and read the full image ID.

```sh
docker load --input "$WAITRON_REHEARSAL_ARCHIVE"
docker image inspect --format '{{.Id}}' "$WAITRON_REHEARSAL_TAG"
```

Put that ID in `rehearsedWaitronImage` in your private `D618_CONFIG`. Use a clean checkout at the rehearsed Cloud commit. The launcher uses that loaded image for the bundle and logs its configuration digest.

```sh
node scripts/amazon-run.mjs measured-stops
```

The Linux rehearsal uses test containers and six-minute holds. Stockholm uses real machines and 15-minute holds.

**Run 9 checks.** Start one disposable venue against production-mode Cloud with test service plans disabled. Use private `.test` DNS and certificates and the real mail transport to a private sink. Verify signup, sign-in, pairing, signed staff and public routes over WireGuard, scoped temporary storage credentials, encrypted capture and genuine isolated restore, along with the [P1 service inventory](2026-10-22-cloud-country-cell.md#coverage-map-and-outside-p1-gates).

- Stop each machine for 15 minutes in turn. Across the legs exercise loss of the database primary, active gateway, database operator and Flux. Keep the same clients and acknowledged data, verify that only one database primary accepts writes, and let replicas heal before the next stop. Keep the 90-second account and remote, 300-second backup and 180-second Git repair bounds. Report longest probe gaps.
- As a separate cold-recovery check, stop all three simultaneously. Confirm the outage from outside the cell. Restart those machines with their disks intact. Record how long recovery takes and verify that the same clients reconnect, acknowledged data and backups survive, and new writes, capture and restore succeed.

**Machines, cost and deletion.** Reuse one disposable stack with three on-demand `m7i.xlarge` machines and 60 GiB encrypted disks each. At the rates saved for run 8, 150 minutes costs **$1.79 before tax, about $2.17 with assumed 21% tax**, including one GB of outbound traffic. The last delayed bill showed roughly $0 before run 8. Run 8 was forecast at $1.35 and actual cumulative spend is unconfirmed. Reconcile posted and pending charges against the owner's $300 cumulative budget (12 November, 18:06 watcher relay). Keep the $10 monthly deny-launch backstop. [Cost basis](2026-11-09-d618-bounded-amazon-run.md)

Schedule stack deletion independently at expiry and delete immediately on failure or cancellation. Allow five minutes for confirmation. Late deletion can cost more. Independently verify removal of the exact stack and its resources, revoke the session's source key and retain redacted evidence.

**Full P1** requires one complete Stockholm proof of the original country-cell criteria, a passing receipt verifier and green CI on the exact Cloud revision. Run 9 also requires the separate cold-recovery check and confirmed deletion. Production launch and off-site disaster recovery have separate gates.
