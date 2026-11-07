# Box error reports plan

D601 implements [monitoring §10](../specs/2026-10-24-cloud-monitoring-alerting-status-design.md#10-error-reports-from-boxes), owner-approved 2026-10-24, Cloud receiving only; free installations qualify. Use signed synthetic fixtures. Watcher questions 2026-11-07 13:08 decides on one report table, real code forms, stable numeric versions and both two-installation floors: “Build now.”

Watcher questions 2026-11-07 13:03: 'hold for a new error only when C >= 5 and at least 2 installations reported it. Keep your doubling rule for errors the predecessor had.' Real masked text waits for A1048/O9. Current campaign request: “The owner authorises finish-branch and land-branch.”

## Contract and comparison

POST `/api/installations/error-report` → `{accepted:true}`; POST `/api/installations/release-held`, body `{version}` → `{version,held}`. Existing signed envelopes; add error-report/release-held MachineActions; held is pure read, without dedup rows.

Report exactly `{code,source,version,time,count,logs}`. Waitron `f519799de` probe: 536 lowercase dotted codes fit letter/digit/underscore components. Bound128; examples `management_session.required`/`storage.disk_full`. Source is metadata: 1–160 characters, relative slash-separated code identifiers, optional #function; ASCII letters/digits/underscore/dot/dollar/hyphen, no empty/dot/dot-dot segments, URLs, colons, backslashes or absolute paths. Logs: 0–8 objects exactly `{level,code,source}`; levels debug/info/warn/error; drop text constant. Identifiers can lie; no AI feed. Count integer 1..1000000; time integer 0..now+60000ms. Canonical JSON, exact keys/no duplicates; body ≤4096 bytes. Stable X.Y.Z, components 0..2147483647, no leading zeros; hand full format to A1048.

Per authenticated environment, predecessor is greatest numeric lower version reported by ≥2 installations; absent predecessor means baseline; unknown version returns false. Aggregate by code+version; moving source cannot fabricate errors. C=sum counts; N=distinct installations reporting that version. With an observed predecessor, hold: C≥5 and ≥2 installations seeing that error, on both paths; new error qualifies, predecessor error additionally requires C/N≥2×predecessor C/N. Doubling/five limits small-count noise. Older versions accumulate more errors, delaying holds on newer versions; only error-reporting boxes form the denominator, so fixing other errors can inflate it. Wider mild failures can stay hidden. Unknown clean releases and claimed versions prevent fleet-incidence claims; two installations can be one venue, and one can supply most counts. One-statement snapshot; late predecessor reports can change held. Watcher 13:08 defers matched-window shares until real reports exist; retain one monitoring backlog line.

## TDD and delivery

Failing test, observed failure, minimal implementation, passing test; weaken no checks.

1. Append `052_box_error_reports.sql` and `packages/registration/src/migrate.ts` manifest; recheck slot. Add `registration/src/box-error-reports.ts` (export in `index.ts`) and `account-http/src/box-error-reports.ts` (wire in `app.ts`), with matching `test/box-error-reports.test.ts` files. One `installation_error_reports` table keyed `(installation_id,operation_id)`: authenticated environment snapshot, body digest, report fields/received_at. Rows deduplicate identical concurrent retries; changed bodies conflict. Store each report’s logs; grouped times are min/max of reported batch-last-occurrence time. Store version as three integers; index environment/version/code. No `installation_operations`, usage or `last_contact_at` writes. Accepted history survives revocation.
2. Trace proof/action consumers. Under installation lock recheck existing proof/current lease/key/origin/action/revoked/superseded/current time after waits. All plans allowed. Use separate box-error IP scope (60/minute), error-report key (10/minute), held-read key (30/minute), preserving installation-ip/key allowances; all-ip120/min stays shared. Max report payload growth is 14,400×4096 bytes/day/key before database overhead; no production capacity claim.
3. Actual HTTP+PostgreSQL TDD: privacy/proof; grouping/moved source/numeric predecessor/late order/single-box fake predecessor; thresholds/normalization/both multi-box floors; environment/replay/concurrency/conflict/revocation/wait expiry; pure held read/no usage/contact effects/installation-scope independence with all-ip shared.
4. Current migration count/tail checks become 52; retain 051 at index50, historical digests/receipt counts. Add populated 51→52 migration/retry test pinning index51 and prior digests, not total/last; historical upgrade modes explicitly run old checkouts, not candidate HEAD (24 fixture/verifier tests passed). Run actual changed migration tests, both installation suites, usage/history and affected upgrade fixtures using explicit nonempty filename lists through `scripts/test-postgres.mjs`; read counts; `pnpm typecheck`. CI owns full suites.
5. Update backlog/affected guides. Claude reads this amendment before build; one Claude whole-branch run-it review, no permanent mutation tests. Single signed-off PR; authorised finish/land, inspect every current-head job and exact merge-commit CI.

- Paging: out of scope.
- Investigator: out of scope.
- Release waves: out of scope.
- Problem-report form: out of scope.
- Waitron opt-in/sender/offline queue/updater: out of scope.
