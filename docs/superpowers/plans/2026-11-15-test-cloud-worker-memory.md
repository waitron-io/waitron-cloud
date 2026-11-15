# Test Cloud worker memory

## Outcome and boundary

Measure `usage-reconciler`, `monitor-worker`, `remote-probe` and
`gateway-manifest` through the Debian pairing-v2 `runTestCloudClients` workload;
commit measured limits and complete one equivalent run without worker kills.
This qualifies only that workload, not shipping or deployment.

Reuse `deploy/test-cloud/runtime.mjs`, `scripts/test-cloud-integration.mjs` and
the existing deployment/cleanup paths. Exclude recovery/authority tests,
quarantined-venue calls, provider access, Docker pruning, new instrumentation
suites, persisted product measurements and changes to release gates.

## Prerequisite

The driver must supply #1213's exact invocation/options, immutable Cloud/Waitron
image identities, Waitron revision and matching pairing-v2 fixture/signing inputs.
Provide an owned fresh disposable Debian amd64 guest with Docker, Compose
2.24.4+, Node 26+, readable cgroup-v2 counters and existing capacity floors.
Use synthetic venues only. If those inputs or the exact scenario are unavailable,
report the missing prerequisite to the watcher; do not qualify a substitute.

## Implementation and measurement

1. Reproduce the recorded run at 64 MiB using the supplied invocation of
   `runTestCloudClients` in `scripts/test-cloud-integration.mjs`.
   Its CLI is `node scripts/test-cloud-integration.mjs`; use it only if its
   default options match. Preserve existing ownership labels and scoped cleanup.
2. From before startup until cleanup, observe all four workers concurrently.
   Resolve owned container PIDs through `docker inspect` and `/proc/<pid>/cgroup`;
   collect `memory.peak`, `memory.events` OOM/kill deltas, Docker OOM/die events,
   `RestartCount`, exit status and container identity changes before removal.
   Track replacement cgroups; reject missing counters. Keep commands/logs in the lane folder.
3. If capped, repeat with temporary, uncommitted Compose limits on the disposable
   guest, giving only these workers headroom before startup. Reject capped peaks;
   preserve aggregate memory/CPU and host-floor protections. Stop for the watcher
   if headroom exceeds existing budgets.
4. Change only those four `mem_limit` entries in
   `deploy/test-cloud/compose.yaml`: peak × 1.25, rounded up to 16 MiB.
   Keep the rendered all-profile total ≤2,048 MiB. If it cannot fit, stop for
   the watcher rather than weaken guards or cut unrelated limits.
5. Repeat the identical workload with committed limits, without temporary
   overrides. Require completion, zero OOM/kill events and zero worker restarts
   from startup through cleanup. Do not count intentional venue restarts.

## Checks, documentation and size

Run `node --test deploy/test-cloud/deployment.test.mjs scripts/test-cloud-deploy.test.mjs`.
Retain “LAN override replaces ports, isolates private state and keeps independent
launch gates off” and “resource guard stops for owned OOM, Waitron health regression
or three consecutive floor failures”, plus all recorded-ownership assertions.
Read executed counts; these checks supplement the measured run.

Only after measurement, add dated peaks, limits, margin, invocation and scope to
`docs/test-cloud.md`; update its aggregate total and narrow `docs/backlog.md`.
Expected added/removed lines: code/configuration +4/−4; tests +0/−0;
docs (including this plan) +65–90/−3–6. No runtime change is planned.
