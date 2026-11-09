# D618: one bounded Amazon experiment

**Authority:** owner 9 November 15:17/21:25; watcher 23:11 approves **PR1 only**, approximately 300 changed lines, **stop at 400 additions plus deletions**. PR2 and all AWS/account access or spending need separate owner approval. The 473-second Claude plan read and correction preceded building.

**Finish:** one owner-started three-machine experiment repeats D620's signup, pairing, remote-access/refusal and captured-backup restore checks before/after manifest host C stops, then deletes everything. PR1 supplies the local kind rehearsal; it establishes no production, data-failover or session-continuity claim.

**PR1 file estimates, additions/deletions:**

| Category | Exact files | +/− |
| --- | --- | --- |
| Production | `scripts/kubernetes-check.mjs` | 105/20 |
| Tests | `scripts/kubernetes-check.test.mjs`; new `scripts/kubernetes-worker-loss.test.mjs` | 115/0 |
| Configuration | `package.json` explicit test list | 1/1 |
| Documentation | this page; `docs/backlog.md` | 43/29 |
| Support | none | 0/0 |

Approximately **314 changed lines**, one PR within three hours. If it exceeds 400, stop with actual counts and the smallest coherent cut; preserve assertions.

- [x] **Test first:** observe failures for verifier deletion/rebinding, role/node refusal, stopped-before-replacement ordering and failure cleanup; implement minimally. Adapter tests own commands/order/repetition; the opt-in runtime test owns both complete journeys. Keep all D620 assertions and existing selected-point drain, jobs, limits and integration guards.
- [x] **Reuse:** export the existing main block as `runKubernetesCheck(target)` in the same file. Settings `kind` and `kind-worker-loss` use an owned `d620-<uuid>` cluster/context, namespace `default`, Docker network `kind` and inspected addresses. Keep the normal one-node command; reject unknown settings/bindings. Delete/wait for the completed verifier before applying its next point; preserve stage/error, termination reason/code and logs through cancellation and replacement.
- [x] **Rehearse:** existing pinned kind/Kubernetes images; A/control-plane hosts Cloud/database/storage/gateway, B the verifier, manifest permits B/C and initially prefers C. SIGKILL C, confirm stopped, mark it out of service, wait for its old worker's deletion and require replacement on B. Keep C off 900 seconds before journey two and through completion. Preserve TLS, forwards, host ports and PostgreSQL DNS. Watcher 23:45 approved one uniquely named, D618-labelled Linux Docker volume: record creation, inspect its mount point, mount into all three nodes at `/var/local/d620-config`, check private write/read/rename on each, and remove that exact volume after success/failure cleanup. Keep socket/file permission checks; Mac-backed socket chmod returned EINVAL.
- [x] **Validate/document:** native command `node --test scripts/kubernetes-check.test.mjs scripts/kubernetes-worker-loss.test.mjs`; full command `TEST_KUBERNETES_WORKER_LOSS=1 node --test scripts/kubernetes-worker-loss.test.mjs`; entry `node scripts/kubernetes-check.mjs --worker-loss`. Watcher 23:19/23:28 approves the shared Mac Docker wrapper, one lane, well above 15% free and without whole-workspace coverage. Check memory before heavy steps. Plan for 4 CPUs, 10 GiB RAM, 30 GiB disk and 30 minutes. Mark D570 dropped, remove its restart/cross-reference text, record PR1 evidence and PR2 pending in the backlog.

**PR1 result:** 10 November ARM64 Mac Docker, 1 pass/0 skips in 1,311.8 seconds; both 15-module restores, 900,043 ms before journey two and owned cleanup. Native checks: 23 pass, two opt-in skips. Linux x86 whole-cluster qualification remains unrun.

**PR2 proposal, owner-gated:** approximately 550 changed lines: production `scripts/{amazon-run,kubernetes-check,test-cloud-integration}.mjs` +170/−10; new `deploy/kubernetes/bounded-amazon/{bootstrap.sh,stack.yaml}` support +110/configuration +140; new `scripts/amazon-run.test.mjs` +70; this page and `docs/{backlog,aws-infrastructure}.md` +30/−20. Launcher/template tests own ordering and teardown; the owner-started run owns actual machine-loss/expiry evidence.

Propose three x86 m7i machines, Debian 13/kubeadm 1.34.3, WireGuard/Flannel. Build pinned images on testbox's `d618-amd64` builder after checking `uname -m`; save/SSH/import into every containerd store (`imagePullPolicy:Never`), A's Docker and B's nested verifier, checking digests. Bind Amazon outputs/context/node/instance/network identities separately from unchanged kind guards. A-owned configuration uses B/C-restricted NFS, mounted before kubelet with private write/rename checks.

Before launch, manually verify the practice account (STS expected identity/non-root plus Organization console), USD10 deny-launch budget/action/role (Budgets/IAM reads and policy simulation; permit teardown), external CloudFormation role (IAM/PassRole simulation), quota minus live usage, and month-to-date spend/current prices. CloudFormation supplies laptop-independent scheduled deletion before machines exist; the external role survives. OpenTofu stays mocked. Launcher `node scripts/amazon-run.mjs start|stop` waits for scheduled deletion from 90 minutes; late/missing `DELETE_COMPLETE` triggers deletion and reports failure. Failure/cancellation deletes immediately. Billing/deletion failures can exceed USD10; check the bill before another run.

**Owner decision pending:** close D110 after successful D618; retain original P1 900/90/300/180-second targets and production-mode acceptance under provisioning in `docs/backlog.md`.
