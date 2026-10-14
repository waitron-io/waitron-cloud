# Precise CI selection

Your documentation PR currently runs 1,477 package tests. Your full run also costs more after splitting jobs: each job repeats setup and rounds up separately. Select actual consumers for every changed path, then group the selected work to reduce those costs without losing checks.

**Boundary:** This design changes pull request test selection and grouping. Operating-cost modelling, daily schedules and the main-run policy are separate work. Execute implementation inline after the reviewed design is landed.

## Evidence and consumer matrix

Read `.github/workflows/ci.yml`, all `scripts/ci-*.mjs`, all ten manifests, both workspace/config layers, deployment inputs and `docs/backlog.md:415` onward. Read-only probes used `git ls-files`, `rg -n` for imports/filesystem/child-process calls, `node --input-type=module` invoking `loadWorkspace()`, and Python/PyYAML walking the lockfile. The tracked-source inventory covered 467 JS/TS files: 92 contain filesystem calls, 84 command/require calls, 58 dynamic imports (overlapping classes). These are inspection receipts, not executed test or timing proofs. Implementation must reconcile every such input site, including aliases and indirect helpers, in both trees; an unresolved site cannot earn a narrow exemption.

| Input | Inspected consumer evidence | Required selection |
| --- | --- | --- |
| `docs/**`, root/package README and other Markdown | `rg` across executable/config sources finds no README data reader; `secret-hash.ts:3` and its test's SOURCE mention are comments. Release `prepare-ui.mjs:25` reads notices from an external Waitron checkout, not Cloud docs. | Changed-Markdown checker plus any discovered real reader; package ownership alone must not schedule package tests for Markdown. |
| `packages/identity/SOURCE.md` | `scripts/identity-upstream.mjs:5-13` reads the default source map; its test supplies a temporary map. | Structural map validation and `identity-upstream.test.mjs`; no external checkout/fetch requirement or identity suite solely for prose. Preserve the upstream CLI's existing checks. |
| `docs/receipts/*.json` | Gateway verifier test `:17-19` reads the published JSON. Capacity v2 uses `verifyBackupCapacityReceipt`; public-gateway uses `verifyPublicGatewayLimitsReceipt`. Operations and AWS JSON have no standalone schema checker in this tree. | Direct existing verifier for mapped JSON, plus tests that read that path. Unknown schema/path fails planner by name until explicitly mapped; JSON parsing alone is insufficient. Never regenerate proof fixtures or run backend suites merely to verify JSON. |
| `scripts/ci-*` | Scope → plan/workflow/CLI; plan → plan/CLI; summary → summary/CLI; reuse → reuse/plan/CLI. Workflow guard reads `ci.yml`. | Own tests and transitive callers; always run CI contract tests when planner, scheduler, runner or workflow wiring changes. |
| Other root scripts | All own `*.test.mjs` imports/spawn callers were inventoried. `database-recovery-migrations.mjs` is imported by registration relay-control, relay-bounds, monitoring-quiet migration tests and fiscal `schema.test.ts:9-13`. Upgrade helpers are imported by `monitoring-upgrade-fixture.test.ts:12-13`. | Syntax checks plus own tests and callers, including those package suites. Editing a helper selects its callers, not every package it imports. A helper with no test/caller still has a nonempty syntax-check unit. |
| `scripts/test-postgres.mjs` | `ci.yml` executes it for every package; it starts PostgreSQL and Mailpit and delegates pnpm. Error-message mentions in tests are not additional executable edges. | Editing this runner reaches every package job: full package work with this named reason. Merely executing it for a portal change does not select unrelated packages. |
| `compose.yaml`, local deployment/config | `compose-contract.test.mjs:6,47-70`, `operations-collector.test.mjs:7`, lifecycle/proof scripts and `local.env` readers; `runtime.mjs:12-16` reads migration module and SQL directory. | Local-stack tests and actual reverse consumers; runtime also selects registration/fiscal migration tests. `.env.example` comments are documentation, but unknown executable configuration changes fall back with reasons. |
| Dockerfiles / `.dockerignore` | Local-stack `COPY . .`/portal build; local-remote copies remote-access source; backup verifier builder copies four named backups files and external Waitron. | Their build/config checks and callers; distinguish those build contexts. Do not infer all package tests from inert copied docs. Unverified build-input rules select full or fail. |
| `.github/**` | CI workflow guard and executable entry points above; `ui-release.yml` reads `scripts/release/ui-source.json`, tests release manifest and builds external pinned UI. | CI wiring → contract guards; release wiring/source → release checks. Never trigger publishing/deployment as selection proof. Unknown workflow/action inputs fall back. Keep independent main concurrency and bounded browser install. |
| Root `package.json` | Root test/proof/CLI scripts enumerate concrete entries; `compose-contract.test.mjs:49` reads `scripts['mail:down']`; root dependencies are only TypeScript and Node types. | Compare fields: changed script → its checks/callers; `mail:down` → compose contract. Compiler/types → typechecks. Engines/packageManager/install-wide fields → full affected work. Unknown fields fail closed; script-map edits are not automatically shared dependency changes. |
| `pnpm-workspace.yaml`, `.npmrc`, manifests | Workspace patterns `packages/*`, `apps/*`; private registry affects UI installation; manifests declare production, dev, optional and peer edges. | Changed membership → added/removed members and consumers from both trees; install policy → all affected installers. If reach is unbounded, full with a field/path reason. Manifest dependency removals retain old consumers. |
| TypeScript configs | Seven backend manifests run `tsc -p ../../tsconfig.json`; root includes **all** `packages/**/*.ts`, including ui-smoke source. Portal overrides include to its source/tests; ui-smoke overrides to its source; both extend root with `skipLibCheck:false`. Portal esbuild uses its config. | Retain one honestly named whole-backend typecheck when backend typed work/dependencies require it. Root config/compiler/Node types → backend + portal + ui-smoke typechecks, and affected portal build/tests. Package config → its compiler/build consumers. Docs and inert MJS helpers do not require backend typechecking. No repeated root check per backend package. |

### Actual package links

The live `loadWorkspace()` probe finds these direct file consumers, supplemented by manifest edges; names below omit `@waitron-cloud/`. Each row means **consumer reads inputs from** its listed packages, not the reverse.

| Consumer | Actual sibling inputs | Evidence examples |
| --- | --- | --- |
| portal | account-http, backups, fiscal-allocation, identity, registration, remote-access | `test/fixtures.ts:1-11`, fiscal browser/controller fixtures, `src/fiscal-allocation-types.ts:1`, remote browser `:8` |
| account-http | backups, fiscal-allocation, identity, registration, remote-access | `src/app.ts`, `test/fixtures.ts:4`, `test/remote-access.test.ts:7` |
| backups | account-http, identity, registration, remote-access | `test/catalogue.test.ts:6`, `test/replacement.test.ts:15` |
| fiscal-allocation | identity, registration | `src/store.ts:3-4`, store/schema fixtures |
| operations | account-http, registration | `test/cli.test.ts:6`, `test/status.test.ts:1,6` |
| registration | account-http, identity, operations | installations/monitoring fixtures; `test/usage-reconcile-cli.test.ts:10` |
| remote-access | account-http, registration | `test/staff-exchange-fixture.ts:5-6`, placement/reconciler fixtures |
| ui-smoke | remote-access | `test.mjs:64` exercises the actual unavailable page |
| identity | none beyond external dependencies | Probe reports empty `pathDependencies`; nine-package reverse closure is real through the links above. |

Do not remove these links or move fixtures merely to reduce CI. The current tracked-source probe found no opaque relative template that adds every package: the quoted-string rule's fallback still matters for new inputs and its synthetic `../../${name}` regression. Resolve bounded templates/concatenations using proven constants, module URL/cwd and finite call-site arguments. Preserve `../migrations/${name}` as a directory input, even for a newly added SQL file. Treat output/temp paths as irrelevant only with a proven producer; arbitrary env/argument paths and unsupported resolution are uncertainty, not imports to discard. Historical migration fixtures archive pinned trees and link current `node_modules` (`migration-release.ts:24-32`): retain the helper, pinned file/directory evidence and current dependency inputs separately.

### Receipt entry points, not production proof commands

Expand the exact five root `test:*` script commands and follow reachable module imports, reads and tested helper calls. Keep syntax-only checks distinct from executed imports. CLI-only blocks guarded by `import.meta.url === pathToFileURL(process.argv[1]).href` do not execute when a composer is imported.

| Suite | Inspected reachable inputs | Narrow rule |
| --- | --- | --- |
| two-venue milestone | Three test roots, ten static modules: composer, milestone helpers, managed/transfer/capacity/two-venue verifiers and managed JSON fixture; no backend import | Those helpers/fixtures select this receipt. Composer's CLI-only transfer/remote/backup launches do not make this test a backend proof. |
| backup capacity | Three roots, eight static modules; `backup-capacity-fixture.mjs:12-13` imports backups storage/object-transfer | Exact backups module closure and capacity/transfer verifiers/fixture. |
| public gateway limits | Two roots, seven static modules; `public-gateway-limits.mjs:10` imports remote-access public gate | Public-gate module closure and gateway helpers/verifier/fixture. |
| local stack | Thirteen test roots; static closure includes operations, registration migration/transaction, remote manifest. Runtime/schema checks, Compose reads, spawned schema-consumer and mocked scheduled-usage CLI add real paths. Upgrade tests exercise pure revision/digest/factor functions; other package callers exercise dynamic seed functions. | Include each proven read/call closure, migration directory and config inputs. A portal file alone does not justify this entire receipt unless an executed reader is established. Do not conflate tested runtime configuration with launching every configured service. |
| database recovery | Two `node --check` roots and two executed test roots. Migration-count test imports registration migrate/transaction; verifier is pure. Syntax-checking the proof generator does not start its account server. | Registration migration module closure and checker/verifier files. Generator's CLI subprocesses select their callers when changed, not all receipt tests for every backend change. |

### Lockfile: resolved graph per importer

PyYAML probe of lockfile v9 found 215 package records, 215 snapshots, zero unresolved or unreachable snapshots. Counts below include transitives, optional edges and workspace-linked importers; root compiler dependencies remain a separate shared input.

| Importer | Reachable snapshots | Peer-context keys retained |
| --- | ---: | --- |
| `.` | 23 | none |
| portal | 194 | hono server, UI-core/lit, axios/debug, follow-redirects/debug, pg-pool/pg |
| account-http | 126 | hono server, axios/debug, follow-redirects/debug, pg-pool/pg |
| backups | 83 | pg-pool/pg |
| fiscal-allocation | 66 | pg-pool/pg |
| identity | 20 | none |
| operations | 17 | pg-pool/pg |
| registration | 57 | pg-pool/pg |
| remote-access | 88 | axios/debug, follow-redirects/debug, pg-pool/pg |
| ui-smoke | 36 | UI-core/lit |

Fingerprint importer declarations plus complete reachable snapshot/metadata records (integrity, platform/engine restrictions, peer metadata and optional/transitive peer information). Preserve full peer-suffixed snapshot identities, aliases and resolved workspace links; associate each peer snapshot with its unsuffixed package metadata without collapsing the snapshot itself. Compare both trees, including removed edges/records: a transitive integrity change without an importer edit still selects every affected importer and its real consumers. Unexplained orphan/new records, missing snapshots, unsupported version/protocol/settings, duplicate keys or malformed YAML select full with a named reason or fail planner. Root TypeScript/Node-type changes select compiler consumers, not runtime suites by proximity.

No production dependency is added for YAML. `import.meta.resolve('yaml'/'js-yaml')` fails here; PyYAML 6.0.3 was only a local probe, not an Actions assumption. Use a bounded v9 parser covering the current block maps/sequences, quoted/plain scalars, flow maps/arrays and all observed fields: package `resolution/engines/cpu/os/hasBin/peerDependencies/peerDependenciesMeta`; snapshot `dependencies/optionalDependencies/optional/transitivePeerDependencies`. Reject anchors, tags, merge keys, multiline values, unsupported fields/protocols and ambiguous indentation rather than partially parsing.

## Selection and validation contract

Use immutable event base/head commit objects and their merge base. Read inventories/blobs from both trees; collect NUL-separated name-status rename/delete evidence with both old/new names (also retain delete/add evidence when rename detection fails). Union reverse input edges from both graphs before selecting work. Deleted consumers, removed links, new files under a read directory, package moves, spaces and mixed changes must not hide required work. Removed required entry points fail validation rather than becoming successful empty work.

Emit version 2 plans with `mode`, immutable `base/head`, `changes`, per-path `reasons`, logical `units`, concrete execution `jobs`, and existing `reuse` evidence. PR base means merge-base; unknown push base may be null only with full selection/reason, never a narrow PR. Unit kinds are docs/script/config/typecheck/package/receipt; IDs and commands come from a validated registry of safe checks, never deployment/publication/proof-generation commands. A work plan requires at least one unit; docs/script plans may have zero package and receipt units. Each unit belongs to exactly one job; package file groups are nonempty, disjoint and cover every current test file once. Unknown timing uses conservative scheduling; unknown inputs select all nine packages, five receipts, compiler/CI guards and applicable direct checks with paths/reasons, or fail when that inventory cannot be trusted.

`ci-plan.mjs` emits `plan`, `work`, `work_matrix`; `ci.yml` runs `changes`, a `work` matrix and `summary`. `ci-run.mjs` executes only validated argv/cwd entries and reports each unit's duration/count; any failed command fails its job. Shared plan validation checks selected entries/files against immutable inventories; runner and summary cannot trust a self-declared incomplete file list. Summary validates schema/allocation, exact expected `work (<id>)` jobs and parent result, rejecting missing, duplicate, unexpected executed, unfinished, cancelled, skipped-required or failed jobs. Only unnecessary work or verified reuse may skip. Empty/malformed matrices/plans and placeholder execution fail. Docs checker validates changed Markdown as UTF-8 without NUL and a final newline, and directly checks mapped JSON/source maps; real docs readers remain additional units. Deleted documents use old-tree reader evidence; they are not mistaken for unreadable head files.

Retain D67 `findReuse` association/latest exact-head same-workflow/completed job evidence and equal-tree comparison. Forced/direct/multi-commit pushes and uncertain/behind merges still run full. Every checkout uses exact head; main concurrency remains per-run. Production landing still requires rebase onto current main, green exact-head CI, fetch/ancestor recheck under the existing shared lock and every exact-merge job read back. No trigger, schedule or main policy change.

## Cost decision and acceptance

The Actions job records show full [run 38556281875](https://github.com/waitron-io/waitron-cloud/actions/runs/38556281875) = 28 jobs/73 rounded minutes/320 seconds between first job start and last finish; other `38551353972` = 72/285 seconds; presplit `38496582645` = 18/55/540 seconds. These job-span measurements exclude initial queueing and are not invoices. Portal baseline JSON also reports seven jobs/18 minutes. Calculate minutes as `sum(ceil(jobSeconds/60))`, never round the aggregate.

| Package | Current groups: total seconds / wrapper-test seconds | Minutes | After policy (measured values required before completion) |
| --- | --- | ---: | --- |
| registration | 7: 121,251,142,154,128,116,224 / 95,223,120,122,101,92,187 | 23 | Balanced explicit file groups; evaluate 4–7 only after file/fixture timings. Four average about 272s using summed tests +37s overhead; not a proved count. |
| account-http | 3: 181,244,166 / 158,218,140 | 12 | Evaluate balanced 2–3; two average 284s with 26s overhead, with little spare time. Reject if measured maximum exceeds 300s. |
| backups | 2: 225,149 / 199,123 | 7 | Keep at least two initially: one implies 348s. Measure shared image preparation/concurrency before regrouping. |
| portal | 3: 223,212,242 / 167,165,195 | 13 | Keep at least three: two imply about 320s. Balance browser files; optionally include ui-smoke within measured capacity. |
| identity | 1: 37 / 19 | 1 | Combine selected fast units sharing setup. |
| operations | 1: 52 / 29 | 1 | Same; preserve per-package command/result/count. |
| remote-access | 1: 93 / 69 | 2 | Same; keep browser consumers separate unless measured safe. |
| fiscal-allocation | 1: 184 / 160 | 4 | Keep historical fetches; combine only where measured capacity permits. |
| ui-smoke | 1: 91 / 24 | 2 | Reuse selected browser job's Chromium setup if combined job stays within budget. |

Non-test overhead is 22–37s registration, 23–26s account, 26s backups, 47–56s portal; ui-smoke pays 67s. Five receipts take 24–33s each with only 1,2,1,12,1s test steps; typecheck is 42s (6s guards, 13s compiler). Wrapper-test steps include database/Mailpit startup, so file/fixture costs are still unmeasured. Choose explicit balanced file groups and combine fast selected units in one installation/fixture job; do not add a global install/artifact job on an unmeasured savings promise (cached installs already take 1–3s).

Optimize rounded cost with measured file groups and setup profiles, preserving runtime concurrency/deadlines. Require actual full PR cost toward 55 minutes or below, every work job about ≤300s and run about ≤600s; iterate packing/setup when the first measurement misses. Do not claim the target met until proved. Record before/after for **each** package (groups/files, setup/build/fixture/test time, counts, allocated/shared minutes), plus separately accounted shared costs. No new shard count is approved solely by averages. All original product/privacy/ownership/expiry and security/recovery assertions remain; only the individually named selection/scheduling assertions in the plan are superseded.
