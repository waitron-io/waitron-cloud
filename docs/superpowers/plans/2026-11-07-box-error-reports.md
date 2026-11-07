# Box error reports plan

D601 implements [monitoring §10](../specs/2026-10-24-cloud-monitoring-alerting-status-design.md#10-error-reports-from-boxes), owner-approved 2026-10-24, Cloud receiving only; free installations qualify. Use signed synthetic fixtures. Watcher questions 2026-11-07 13:08 approves one report table, real code forms, stable numeric versions and both two-installation floors: “Build now.”

Authority: queue D601: 'State in the plan how "much more common" is decided, as a number the builder sets, and why.' Watcher questions 2026-11-07 13:03: 'hold for a new error only when C >= 5 and at least 2 installations reported it. Keep your doubling rule for errors the predecessor had.' Structural logs accepted; real masked text waits for A1048/O9.

## Contract and comparison

POST `/api/installations/error-report` → `{accepted:true}`; POST `/api/installations/release-held`, body `{version}` → `{version,held}`. Existing signed envelopes/MachineActions; held is pure read, without dedup rows.

Report exactly `{code,source,version,time,count,logs}`. Driver probe: Waitron `f519799de0509915c3655e39bf8dad1b350ec950`, 536 lowercase dotted declarations, maximum 41 characters; all fit lowercase letters/digits/underscore dot-separated identifiers. Bound codes at 128; examples `management_session.required`/`storage.disk_full`. Source is metadata: 1–160 characters, relative slash-separated code identifiers, optional #function; ASCII letters/digits/underscore/dot/dollar/hyphen, no empty/dot/dot-dot segments, URLs, colons, backslashes or absolute paths. Logs: 0–8 objects exactly `{level,code,source}`; levels debug/info/warn/error; drop text constant. Identifier syntax cannot prove honest content; no AI feed. Count integer 1..1000000; time integer 0..now+60000ms. Canonical JSON, exact keys/no duplicates; body ≤4096 bytes. Package version 0.0.0 proves no release sequence: stable X.Y.Z is an A1048 draft, numeric components 0..2147483647, no leading zeros.

Per authenticated environment, predecessor is greatest numerically observed lower version; first establishes baseline; unknown version returns false. Aggregate SQL by code+version, never source: moving source cannot fabricate an error. C=sum counts; N=distinct installations reporting that version. With an observed predecessor, draft hold: C≥5 and ≥2 installations seeing that error, on both paths; new error qualifies, predecessor error additionally requires C/N≥2×predecessor C/N. Doubling/five limits small-count noise. Lifetime counts/denominator bias and unknown clean releases prevent fleet-incidence claims; signed version is no release catalogue. One-statement snapshot; late predecessor reports can change held. Watcher 13:08 defers matched-window shares until real reports exist; retain one monitoring backlog line.

## TDD and delivery

Write failing assertions, observe expected failure, implement minimally, rerun; weaken no checks.

1. Append `052_box_error_reports.sql` and `packages/registration/src/migrate.ts` manifest; recheck slot. Add `registration/src/box-error-reports.ts` (export in `index.ts`) and `account-http/src/box-error-reports.ts` (wire in `app.ts`), with matching `test/box-error-reports.test.ts` files. One `installation_error_reports` table keyed `(installation_id,operation_id)`: authenticated environment snapshot, body digest, report fields/received_at. Rows deduplicate identical concurrent retries; changed bodies conflict. SQL retains first received log sample, min/max reported time. No `installation_operations`, usage or `last_contact_at` writes. Accepted history survives revocation.
2. Trace proof/action consumers. Under installation lock recheck existing proof/current lease/key/origin/action/revoked/superseded/current time after waits. All plans allowed. Sender batches incremental counts within shared IP/key budget.
3. Actual HTTP+PostgreSQL TDD: privacy/proof; grouping/moved source/numeric predecessor/late order; thresholds/normalization/both multi-box floors; environment/replay/concurrency/conflict/revocation/wait expiry; pure held read/no usage/contact effects.
4. Current migration count/tail checks become 52; retain 051 at index50, historical digests/receipt counts. Run actual changed migration tests, both installation suites, usage/history and affected upgrade fixtures using explicit nonempty filename lists through `scripts/test-postgres.mjs`; read counts; `pnpm typecheck`. CI owns full suites.
5. Update backlog/affected guides. Existing Claude plan review precedes build; one Claude whole-branch run-it review, no permanent mutation tests. Single signed-off PR; authorised finish/land, inspect every current-head job and exact merge-commit CI.

- Paging: out of scope.
- Investigator: out of scope.
- Release waves: out of scope.
- Problem-report form: out of scope.
- Waitron opt-in/sender/offline queue/updater: out of scope.
