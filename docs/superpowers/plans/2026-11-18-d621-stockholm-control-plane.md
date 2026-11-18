# D621 run 9, PR 1 — Three machines run the Kubernetes control plane

Today A runs the only Kubernetes API and etcd, the cluster's database. After this change, each machine
runs both. After any one machine stops, the other two can accept and run new work. The stopped
machine can restart and rejoin with its original data. This delivers the three-member control plane
in [P1 Task 1](2026-10-22-cloud-country-cell.md#task-1-own-tools-capacity-and-all-local-resources-4060-calls).

1. In `deploy/kubernetes/bounded-amazon/bootstrap.sh` and `scripts/amazon-run.mjs`, reuse kubeadm
   1.34.3, containerd, Flannel and the private WireGuard mesh. Initialise A with a private API name
   on port 6443 and certificate upload. Pass short-lived join credentials and the certificate key
   over SSH stdin, with secret output suppressed. Join B and C in order as control-plane members.
   Derive each advertised address from its mesh interface. Wait for healthy etcd after each join.
2. Use that API name in each member's kubeconfig and certificate. Give B and C a local hosts-file
   entry for A during their join, then point it at their own API server. Rename the context on every
   member. Refresh kube-proxy once after updating the entries so its pods pick up the new hosts files.
   Check that each member can reach its own API by name. Make all three schedulable.
   [Kubeadm 1.34 procedure](https://v1-34.docs.kubernetes.io/docs/setup/production-environment/tools/kubeadm/high-availability/).
3. Keep the existing shared mount requirement for the legacy fixture, and keep its A/B/C names and
   `target.address` for the service and gateway. Keep `start` and `observe` using their existing Cloud
   journeys. Time bootstrap against the existing observer and deletion deadlines in the later dry run.
4. Start with failing checks in `deploy/kubernetes/bounded-amazon/bootstrap.test.mjs` for endpoint
   resolution, certificate inputs and mesh-local joins. In `scripts/amazon-run.test.mjs`, use synthetic
   commands to check join order, membership before fixtures and deletion after a bootstrap failure.
   Keep the existing binding and deletion assertions. These cases check the bootstrap and launcher.
5. Add an opt-in `scripts/kubernetes-control-plane.test.mjs` check with three pinned Kind control
   planes, an owned network, the existing loopback balancer and a private kubeconfig. Record each
   node's address, exact container ID and etcd member ID. For each node, stop it abruptly by ID, wait
   for the survivors to see it as unavailable, and use a survivor API to create a new Ready workload
   with no shared mount. Check the workload's node. Restart the same container with the same address
   and require all original etcd members healthy before the next stop. Record cleanup of the nodes,
   network and balancer. Run the check locally with zero skips. The Kind check proves scheduling and
   rejoin. The dry-run bootstrap tests cover the endpoint configuration.
6. Run the named tests and add the automated cases to `package.json`'s `test:local-stack` command.
   Update the P1 entry in `docs/backlog.md` and the bounded-run section of `docs/aws-infrastructure.md`.

Estimate **200–330 implementation lines and 150–230 test lines**. Keep the firewall, machine count,
expiry and independent deletion. Later slices cover data and services. PR 7 owns live single-machine
stops, return to the three-member baseline and refreshing addresses for that rehearsal. PR 8 covers
all-machine restart and waits for the owner's run 9 decision. This slice uses local and dry-run checks.
