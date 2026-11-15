# Test Cloud worker memory

## Outcome and boundary

Watcher amendment, 15 November 03:38: build the baseline from current Cloud main
and Waitron `8eed667ab0586a3144ed7911b57cf50fcb3b0766` (contract 0.2.16); keep
that Waitron image unchanged across measurements. This qualifies the current
workload, not #1213’s exact images, and replaces only the missing-input refusal.

Measure `usage-reconciler`, `monitor-worker`, `remote-probe` and
`gateway-manifest` in #1213’s Debian pairing-v2 `runTestCloudClients` workload;
set limits from measured peaks with margin, or cut plainly wasteful launcher
memory, then complete one equivalent run without worker kills or restarts.
This qualifies that workload only. Reuse the existing integration runner,
runtime and scoped cleanup; add no product instrumentation or new release gate.
Leave the quarantined Waitron venue alone. No provider access or Docker pruning.

## Inputs and budget

Recover #1213’s exact invocation/options, immutable Cloud/Waitron image IDs,
Waitron revision and matching synthetic pairing-v2 fixture/signing inputs from
saved receipts. Use an owned fresh Debian amd64 guest with Docker, Compose
2.24.4+, Node 26+ and readable cgroup-v2 counters. Missing inputs stop this item;
do not qualify a substitute or call the quarantined venue.

The all-profile limits total 1,952 MiB (`deploy/test-cloud/compose.yaml`), leaving
96 MiB below the existing 2,048 MiB limit. Recorded peaks above 64 MiB would
require four 96 MiB caps under the margin below, so raising caps alone cannot fit.
`deploy/test-cloud/runtime.mjs` retains a Node launcher alongside each worker;
its contribution is a measurement lead, not a proven cause.

## Measurement and change

1. Run the same workload once with temporary, uncommitted headroom for only
   these four workers, in a signed-off throwaway commit in the owned guest checkout
   (never pushed), preserving clean-tree provenance. Use the exported runner
   with the recorded options; use its CLI only if the defaults match. Keep its
   measured aggregate 2 GiB guard, host floors, diagnostics and owned cleanup.
   Temporary configured headroom is not a change to the committed limit budget.
2. Poll each worker’s cgroup `memory.peak` and each process’s `/proc` `VmHWM`
   about once a second until cleanup. Read `oom_kill`, Docker `OOMKilled` and
   `RestartCount` before removal. Any worker restart, kill, capped peak or missing
   counter invalidates measurement. Keep this one-off observer in the lane folder.
3. If process readings confirm substantial retained launcher waste, remove that
   overhead in `deploy/test-cloud/runtime.mjs` for these workers. Preserve its
   validated, narrowed environment, command/arguments, signals and exit status;
   leave unrelated roles and worker business logic alone. Use TDD for this change,
   then build one new immutable Cloud image from that revision and repeat the
   measurement with it. Keep the Waitron image and all other inputs unchanged.
   If the readings show too little removable waste to fit, report to the watcher.
4. Set only the four `mem_limit` entries to peak × 1.25, rounded up to 16 MiB,
   retaining the committed all-profile total ≤2,048 MiB. If measured use still
   cannot fit, report the evidence to the watcher; weaken no guard or other cap.
5. Run the identical workload with committed limits and no override. Require
   completion, zero worker `oom_kill`, `OOMKilled` and restarts before cleanup.
   Intentional venue restarts are outside these four worker checks.

## Tests, documentation and size

`deploy/test-cloud/runtime.test.mjs` owns environment/command assertions; if the
launcher changes, add failing coverage there for its launch/exit/signal contract.
Run it plus `deploy/test-cloud/deployment.test.mjs` and
`scripts/test-cloud-deploy.test.mjs` by explicit filenames. Render checks run
on the approved test infrastructure, never directly through the Mac’s Docker.
Preserve existing ownership, OOM, health and capacity-floor assertions.

Add 15–25 lines to `docs/test-cloud.md` for dated peaks, caps, margin, invocation
and scope; correct its stale limit total and narrow `docs/backlog.md`. Including this plan,
expect production/config +10–35/−5–20, tests +15–35/−0–5, docs +80–95/−3–6 lines.
