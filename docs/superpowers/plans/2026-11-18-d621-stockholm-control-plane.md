# D621 run 9, PR 1 — Three machines run the Kubernetes control plane

Today A runs the only Kubernetes API and etcd, the cluster's database. This slice builds and
command-tests the setup for three control-plane members. The legacy fixture still needs A's network
mount. PR 7 and run 9 will test real machine loss. This starts the three-member control plane in
[P1 Task 1](2026-10-22-cloud-country-cell.md#task-1-own-tools-capacity-and-all-local-resources-4060-calls).

1. In `deploy/kubernetes/bounded-amazon/bootstrap.sh` and `scripts/amazon-run.mjs`, reuse kubeadm
   1.34.3, containerd, Flannel and the WireGuard mesh. Give A the private API name in its hosts file
   before initialising with certificate upload. Pass the short-lived join command and certificate
   key over SSH stdin. Keep those values out of the logs. Update the bootstrap's join guard to
   accept only the private API endpoint. Join B and C as control-plane members, in order, using
   each member's mesh address. Wait for etcd readiness before moving on from each join.
2. Point the private name at A during each join, then at the joining machine's own API. Use the
   name in the admin kubeconfig and API certificates. Rename each admin context, check the local
   API by name, and make each machine schedulable. Refresh kube-proxy after changing the hosts
   entries. Keep the legacy fixture's mount, A/B/C names, `target.address`, and `start` and `observe`
   journeys. PR 7 owns the restart checks for swap, loaded network modules and Docker's forwarding
   policy. [Kubeadm 1.34 procedure](https://v1-34.docs.kubernetes.io/docs/setup/production-environment/tools/kubeadm/high-availability/).
3. Start with failing checks in `deploy/kubernetes/bounded-amazon/bootstrap.test.mjs` for A's
   initialisation, the join endpoint guard, and B and C's mesh-local joins. Use only stub commands
   on PATH and a temporary hosts-file path, including when the test runs as root. In
   `scripts/amazon-run.test.mjs`, check join order, readiness before fixtures and deletion after a
   bootstrap failure. Keep the binding and deletion assertions. The fake join changes to the
   private endpoint. List that fixture change under **Changed test checks** in the pull request.
4. Add the new file to `package.json`'s `test:local-stack` command. Update `docs/backlog.md` and
   `docs/aws-infrastructure.md` to describe the command-tested setup and later machine-loss proof.

Estimate **80–130 implementation lines and 100–160 test lines**. Stop for review above 195
implementation or 240 test lines. PR 2 takes the opt-in Kind check with three control planes, a
fixed-subnet network, the loopback balancer and a private kubeconfig. Stop each exact node by ID,
start a workload via a survivor, and check that the original etcd members return healthy after
reconnecting the stopped node with its original IP. Keep the firewall, machine count, expiry and
independent deletion. PR 8, the all-machine restart, waits for the owner's run 9 decision.
