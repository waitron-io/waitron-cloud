# Operating cost

The [offline calculator](../cloud-cost-calculator.html) and
[model](../cloud-cost-model.md) compare the running platform and per-venue usage; the
[approved design](../superpowers/specs/2026-10-14-cloud-cost-model-design.md) defines the
evidence boundary. The complete bill remains unknown: missing prices, minimums and blank
inputs stay named gaps, and neither a priced subtotal nor a passing command means a
complete or provider-validated budget. The accepted local samples
([joined evidence](../cost-model/local-driver-evidence.json)) keep their own source, clock and
limits; never add overlapping samples or substitute one's transfers for another's. Private
replay uses owned scratch and an internal network, and raw data stays on the Mac. No fiscal
allocation, hash-chain or golden rule is changed.

The [trial assessment](../cost-model/live-check.json) stops before any AWS creation: its
illustrative high-cadence component alone projects 130,000 requests above the 10,000 cap,
an assumed sensitivity rather than a proved bound. No resources were created and no billing
read is due. Independent synthetic generation, an owned-resource runner and durable billing
execution are prerequisites if it is revisited.

Rebuild and verify with `node scripts/cloud-cost/cli.mjs build` and `… verify`;
`pnpm test:cloud-cost` runs the synthetic checks and `pnpm test:cloud-cost:conformance` the
generated-data checks.

**To complete the total:** missing inventory quantities and regional billing terms,
representative venue and public activity, complete retained-object forecasts,
recovery/alert/email frequencies and provider capacity/transfer mappings. Keep external
mail, fiscal API fees, GitHub charges, allowances, credits and tax separate from gross AWS
usage. Keep generated fixture data within each service's 64 MiB scratch limit, or make a
separate bounded capacity change. A generated restore-integrity failure reproduces on the
host-shared Docker folder and passes on container-native storage; its production relevance
is unproved, so prepare a consistent frozen copy before long replay. Earlier untraced refusals
and transient source-file changes are unattributed; later activity in a live source is not
proof that the isolated experiment wrote it.

## Unexplained rehearsal refusals

Each now reports a fixed stage or category; capture that on a recurrence, reproduce it
with the pinned runtime and fix the cause. Passing repeats explain nothing. Keep every
accounting, ownership, isolation, restore, cleanup check and deadline.

| Refusal | Evidence to start from |
| --- | --- |
| Streamed-day check at `private-replay` | [run 41003745800](https://github.com/waitron-io/waitron-cloud/actions/runs/41003745800/job/123893874129) |
| Stack start before archive assertions | [run 39743485615](https://github.com/waitron-io/waitron-cloud/actions/runs/39743485615/job/119706230844), and the older 39616174409 and 39627846860 |
| Paced replay, generic error | 39637622744, [39829272927](https://github.com/waitron-io/waitron-cloud/actions/runs/39829272927/job/120000877058) |
| Paced replay at `quiesce` | [40489223783](https://github.com/waitron-io/waitron-cloud/actions/runs/40489223783/job/122138753711) |
| Paced replay at `quiesce-checkpoint` | [40954158356](https://github.com/waitron-io/waitron-cloud/actions/runs/40954158356/job/123729967144), [41449381877](https://github.com/waitron-io/waitron-cloud/actions/runs/41449381877/job/125290693382) (`transfer-interrupted`) |
| Paced replay at `quiesce-idle` (D581) | [nightly 43207714335](https://github.com/waitron-io/waitron-cloud/actions/runs/43207714335) |
| Paced replay at `storage-cleanup` (D121) | [40144665901](https://github.com/waitron-io/waitron-cloud/actions/runs/40144665901/job/121023380173) |
| Writer-deadline check during opening | [40259519210](https://github.com/waitron-io/waitron-cloud/actions/runs/40259519210/job/121368783695), [43971423269](https://github.com/waitron-io/waitron-cloud/actions/runs/43971423269) |
| Remote browser journey, mostly reconnect/takings | [39890570428](https://github.com/waitron-io/waitron-cloud/actions/runs/39890570428/job/120209134728), [40004973526](https://github.com/waitron-io/waitron-cloud/actions/runs/40004973526/job/120590562266), [40092022379](https://github.com/waitron-io/waitron-cloud/actions/runs/40092022379/job/120866647453), [40122070386](https://github.com/waitron-io/waitron-cloud/actions/runs/40122070386/job/120955659784); [investigation](browser-reconnect.md) |
| Mail measurement close (D262, PR #467) | [job 121192744128](https://github.com/waitron-io/waitron-cloud/actions/runs/40201247616/job/121192744128). Read the close error's first reason and both counts: a timeout, a protocol failure and a disagreement after an accepted reply need different reproductions. |
| SIGINT cleanup before a worker was admitted (D502) | [run 41003177471](https://github.com/waitron-io/waitron-cloud/actions/runs/41003177471/job/123892097439). Read `local-command-refusal` first; controls in `scripts/cloud-cost/local-command-diagnostics.test.mjs`. |

The strict 4.01-second streamed-day control must refuse after its original deadline in
whichever phase it reaches, with the source unchanged, private state removed and every
started child collected and exited (owner, 24 October 2026).

The official Litestream shutdown also still needs qualification
([scheduling investigation](cost-conformance-fixtures.md#replay-close-scheduling-d530)).
