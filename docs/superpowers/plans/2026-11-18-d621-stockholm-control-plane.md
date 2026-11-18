# D621 run 9, PR 1 — Three machines run the Kubernetes control plane

Today A runs the only Kubernetes API and etcd, the cluster's database. After this change, each machine
runs both. After any one machine stops, the other two can accept a new workload and run it. The stopped
machine can restart and rejoin with its original data. This slice implements
[Tasks 1 and 4 of the P1 plan](2026-10-22-cloud-country-cell.md) for the bounded Stockholm rehearsal.

1. In `deploy/kubernetes/bounded-amazon/bootstrap.sh` and `scripts/amazon-run.mjs`, reuse kubeadm
   1.34.3, containerd, Flannel and the existing private WireGuard mesh. Initialise A. Join B and C in
   order as control-plane members, each with its own advertised mesh address. Pass short-lived join
   credentials privately and keep them out of logs and artifacts. Start kubelet after the mesh on
   every machine. Remove the scheduling taint on all three and require three healthy etcd members.
2. Run stock HAProxy on each machine before kubeadm starts. Resolve one private API name to loopback
   on each machine and listen there on port 16443. Forward TLS to the ready API servers on the mesh at
   port 6443, with the private name in every API certificate. Use each survivor's own kubeconfig.
   Reuse the [kubeadm 1.34 high-availability procedure](https://v1-34.docs.kubernetes.io/docs/setup/production-environment/tools/kubeadm/high-availability/).
3. Separate control-plane startup from A's shared file mount. Keep the existing image copy and
   require the mount before starting the legacy test fixture, including when the fixture restarts.
   Keep the current A/B/C names and `target.address` used by the service and gateway checks.
   Keep `start` and `observe` using their existing Cloud journeys. Their observer and Git mirror still
   run on A. The separate cluster check needs only the existing Kubernetes image and a small workload.
4. Start with failing checks in `deploy/kubernetes/bounded-amazon/bootstrap.test.mjs` for the join
   inputs, local proxy and kubelet startup without A's mount. Extend `scripts/amazon-run.test.mjs` to
   cover the order of preparation and joins, healthy membership before fixtures and cleanup on
   bootstrap failure with synthetic commands. Keep the existing binding and deletion assertions.
5. Add an opt-in local check in `scripts/kubernetes-control-plane.test.mjs`. Use three disposable
   control-plane nodes with the pinned Kind image, the same proxy settings and private kubeconfigs.
   For A, B and C in turn, confirm the node has stopped by its recorded resource ID. Use a surviving
   node's local proxy to write to the API and schedule a new Ready workload on a survivor. Restart the
   same node and verify its original etcd member is healthy before the next stop. Retain ownership and
   cleanup evidence. Kind exercises Kubernetes and the proxy. Validate the Debian bootstrap inputs
   separately and leave live WireGuard and Stockholm qualification to the authorized rehearsal.
6. Run the named test files and add the automated cases to `package.json`'s `test:local-stack` command.
   Update the P1 entry in `docs/backlog.md` and the bounded-run section of `docs/aws-infrastructure.md`.

Estimate **300–450 implementation lines and 180–260 test lines**. Keep the existing firewall, machine
count, expiry and independent deletion. Use local and dry-run checks. The later slices cover PostgreSQL,
storage, keys, services, remote access, observation from outside the cell and all-machine restart.
The paid rehearsal requires a separate owner decision.
