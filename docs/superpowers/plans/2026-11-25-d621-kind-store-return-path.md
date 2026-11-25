# D621 Kind store return path

Complete all three machine stops, storage repairs and the full restart on the free Linux Kind rehearsal twice, with one WireGuard sample logged after each repair. Use committed Cloud source and the pinned Waitron image. Request the paid Stockholm run and give its cost after both passes.

In the 25 November free run, both Ready pods and their Docker bridge port returned six-drive counts during the second machine return. WireGuard handshakes were current, but the storage port timed out before TCP in 22 samples and the run stopped at the 180-second deadline. The first repair reported zero incomplete objects. The cause of the WireGuard timeout is unproved.

## Change

- In `scripts/kubernetes-outside.mjs`, wait within the existing return deadline until systemd is process 1 before restoring WireGuard. The Kind startup script restores packet rules before it starts systemd.
- In `scripts/kubernetes-services.mjs`, select the returning machine from the original nodes by name. Kind's address is on its Docker bridge. Amazon's existing address is on WireGuard. Pass the three Kind bridge addresses through `scripts/kubernetes-storage-proof.mjs` and include them in the test certificate in `scripts/kubernetes-storage.mjs`. Reuse the six-drive check and the existing signed repair with its three-attempt limit.
- Bound the full metrics request to five seconds in `scripts/kubernetes-storage-proof.mjs`, and preserve caller cancellation. On Kind, log one optional WireGuard sample after each repair. If the read fails, record the returning machine's `D618-OUTSIDE` filter and its route to the host. Continue the rehearsal. Keep the outside HTTPS, mail, publication, backup and restart checks.

## Verification

- `scripts/kubernetes-services.test.mjs` checks the systemd wait, the repair paths for Kind and Amazon, and continuation after a refused Kind WireGuard sample. `scripts/kubernetes-storage.test.mjs` checks the request deadline, caller cancellation and TLS certificate addresses. Expected size is about 30–40 implementation and 35–45 test lines.
- Update `docs/backlog.md` and `docs/aws-infrastructure.md`. Run both free Linux rehearsals with signed uploads required and record machine return, repair, application recovery and restart. The rehearsal has a 54-minute limit within the guest's 55-minute limit.
