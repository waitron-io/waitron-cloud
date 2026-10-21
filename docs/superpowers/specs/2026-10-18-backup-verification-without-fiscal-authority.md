# Backup verification without fiscal authority

Status: **approved by the owner on 18 October 2026; Waitron interface landed,
Cloud integration and joint runtime proof pending**.
This answers D79 PR5's fiscal blocker. The owner approved the shared contract at
approximately 10:10. Waitron A850 landed in
[#1939](https://github.com/clintongormley/waitron/pull/1939) at
`5516dd57e9ae4c52e1a68f35f1e1860ff00e2faa`. Its
[release handoff](https://github.com/clintongormley/waitron/blob/9fbbcd2daae08bb0d943186eff9bba8599002e9c/docs/superpowers/plans/2026-10-20-a850-backup-verification.md#task-27-completion-and-implementing-release--21-october-2026)
identifies the implementing bundle and complete target descriptor. Follow the
[Cloud implementation plan](../plans/2026-10-21-cloud-backup-verification.md)
under existing campaign authority. The historical source observations below stay
pinned to their original revisions; the handoff is not Cloud runtime evidence.
Keep snapshots unavailable until implementation and the acceptance evidence below.
The existing activation path and guards stay intact.

## The promise you can make

You need to know that an archive can recover its data before losing the original
server. Checking that must not give Cloud permission to operate a fiscal installation.
Recommend a Waitron-owned **data restore verification** interface: decrypt and place
the complete recovery data in disposable storage, migrate it to an exact target
runtime, and check every module's recovery obligations without activating anything.

A successful result means: “This exact archive restored its required data and
secrets for this target version, with complete module checks and preserved immutable
evidence. Activation still requires Waitron's separate authority.” It does not prove
that a future allocation, external credential renewal or trading start will succeed.
Cloud supplies no fiscal names, numbers, registry mutations, restore or promotion
allocation, licence to trade or equivalent grant. Reading captured identities is
permitted inside the private verifier; assigning or activating them is not.

Do not substitute SQLite integrity, a preview, skipped hooks or a rolled-back fiscal
activation for this promise. Each restore hook's data effects need an independently
testable verification contract owned by that module. If a required data effect cannot
be checked without authority, return `needs_authority` and keep the point unavailable.
An explicitly classified activation-only effect remains outside the promise; it is
never reported as executed or proved.

## Evidence and source boundary

Cloud source observations use
`86b8e5ab727700e0b1bfa56bad2f6bb194687098`. Cloud links below refer to the source
tree at that revision. All Waitron source links pin
`e52c997c02d2fcd66d0e7239cbfd79ced4ddd0ee`, inspected with `git show`, not executed.

- The supplied local D79 PR5 execution receipts record genuine encrypted capture
  and signed publication, but **zero successful genuine snapshot checks**. The
  snapshot proof fails its “must reach verified” assertion. The separate diagnostic records
  `restore.hook_failed / sif.allocation_invalid / reauthentication_required`.
  These are supplied receipts, not a new run or evidence of successful recovery.
  Their locations remain in the private campaign ledger, outside this repository.
- Cloud's [child](../../../packages/backups/src/waitron-verify-child.mjs), lines
  23–40, checks manifest, capture time, source node and SQLite integrity, then calls
  `writeValidated` without module authority and expects every restore hook to finish.
  Supporting controller/adapter passes in the checkpoint do not discharge that failure.
- Waitron's [restore host][w-restore], lines 279–307 and 644–725, migrates, runs
  hooks and settles live invoice series; lines 316–341 also manage a first-start
  marker. The [hook contract][w-hook] expressly concerns taking an identity and trading.
  [Fiscal restore][w-allocated], lines 49–60, calls allocation activation when a live
  SIF exists; lines 15–16 refuse absent authority. [Fiscal exports][w-fiscal-restore]
  and [composition][w-composition], lines 239–257, connect that hook.
- [Recovery preview][w-preview], lines 32–77, validates and migrates a private copy
  and reads identity. It neither verifies all module obligations nor runs ordinary
  restore hooks, and returns private business details unsuitable for Cloud results.
  [Fiscal `verifyChain`][w-chain], lines 41–105, examines only the last two records;
  it is not a full-history archive verifier. [Daily-close verification][w-closes]
  does walk its whole chain and check its stored head, but is only one data check.

This design supplements the [reviewed D79 design](2026-10-17-test-cloud-free-paid-design.md)
and [PR5 plan](../plans/2026-10-17-test-cloud-free-paid.md), and follows
[documentation ownership](../../documentation-ownership.md), the
[integration contract](../../waitron-integration-contract.md#recovery-verification-and-failure-handling)
and [current unavailable test deployment](../../test-cloud.md#backup-verifier-boundary).
Older local recovery receipts in those documents do not prove this pinned path.

## Waitron dependency: A850

Waitron owns archive formats, restore mechanics and module semantics. Cloud owns
storage, orchestration, result admission and catalogue availability. This document
is the approved shared verification contract; the Waitron implementation must link
back to it. No Cloud copy of fiscal rules or special fiscal exemption is acceptable.

The following names extend the existing [module backup contribution][w-module];
they are proposed interfaces and files, not existing exports:

| Owner and exact home | Required contract |
| --- | --- |
| `@waitron/module`: new `packages/module/src/backup-verification.ts`, exports in `src/index.ts`; extend `ModuleBackupContribution` in `src/module.ts` | Define `BackupVerificationContribution` with a version, explicit data/secret obligations, classification of each restore effect as data or activation, and a read-only `verifyRestoredData` callback. Require an explicit `database_only` declaration when no additional obligations exist; absence is unsupported, never success. Return fixed check codes and `passed`, `invalid`, `needs_authority` or `unsupported`, without free-form reports. The context exposes query-only data and declared scratch entries, no `ModuleOperationInput`, operation preparer, writable transaction, network client or provisioning service. Enforce read-only access beneath the types. |
| Waitron server: new `apps/server/src/backup-verification.ts`; factor reusable placement from `src/restore.ts` only as needed | Export `verifyBackupArtifact(request, deps): Promise<BackupVerificationResult>`. Accept a closed private encrypted archive file and separately delivered matching recovery key, expected binding, target module composition and private scratch root. Reuse archive validation, traversal/duplicate guards, identity validation, real placement and migrations. Validate required secrets and module state explicitly. Do not call `writeValidated`, `runRestoreHooks`, module operations or first-start boot. Share data placement rather than add a `skipFiscal`/`skipHooks` switch to ordinary restore. |
| Waitron server recovery client: `apps/server/src/cloud-recovery.ts`; Cloud `packages/backups/src/{recovery-request,recovery}.ts` and `packages/account-http/src/recovery.ts` | Add a negotiated v2 snapshot recovery request binding the target runtime/composition/policy descriptor to the fresh target key and request ID. Return the matching verification descriptor with snapshot info/read responses; Waitron compares it with its running binary before any placement. Preserve existing v1 and continuous behavior outside this new policy; v1 supplies no target identity and cannot qualify this snapshot path. This is version binding, not remote attestation or activation authority. |
| `@waitron/composition`: `packages/composition/src/modules.ts`; media descriptor `packages/media/src/module.ts` | Register a verification contribution for every descriptor. Validate complete coverage and dependencies before work, including inactive modules whose tables/evidence are in the archive. No fallback to `fiscal-none`, filtering the fiscal module, or “no hook means checked”. |
| `@waitron/fiscal-verifactu`: new `packages/fiscal-verifactu/src/backup-verification.ts`, export via `src/index.ts` | Own full captured fiscal history, chain/head/sequence relationships, registration history, stored allocation receipts and public signature validation where applicable. Check source-node relationships and preservation of immutable evidence before and after migration. Classify assigning a fresh installation/series as activation-only. Leave `allocated-lifecycle.ts`, `restore.ts` and their authority requirements unchanged. |
| Each other module's owning package, with contribution wired in composition | Own its data, non-database state, secret usability and any restore-derived invariants. Core `@waitron/db` owns identities, existing series and database relationships; `@waitron/reporting` owns close-history checks used by the core contribution. Each owner must justify `database_only` or supply checks; Cloud cannot make that choice for it. |

Coverage at the pinned composition is **15 modules**: core, catalogue, venue-service,
media, identity, workforce, workforce-es, payments, scheduler, credentials,
fiscal-verifactu, fiscal-none, bookings, adjustments and staffing. The acceptance
inventory must be generated from the shipped composition, not this prose list.
Compare it with every archive manifest entry, applied migration record and captured
`modules.json` when present. [Manifest v1][w-manifest] includes schema count zero for
unmigrated modules; zero still needs an explicit owner-defined not-applicable check.
Target-only modules require an explicit compatible empty-data/migration rule.

The ordinary [compatibility gate][w-gate] deliberately ignores absent target modules.
Keep that behavior for existing callers, but the new verification interface refuses
missing source modules, unknown verification semantics, incompatible dependencies,
newer schemas or environment mismatch. A successful preview is insufficient.
Pin the verifier image, target Waitron release/revision, module package versions, migration-set
digests and verification-policy versions; never infer package versions from schema
counts. A result qualifies that target only. Another target needs a new check;
existing rows without this contract must not be silently relabelled.
The verifier wrapper image identifies the checking environment; the target descriptor
identifies the Waitron runtime being qualified. A native target supplies its release
fingerprint, not a fictitious Docker image. Waitron owns descriptor construction in
the proposed server `backup-verification.ts` and compares it locally during recovery.
The current [recovery client][w-cloud-recovery], lines 252–276, and Cloud
`recovery-request.ts:11–18` have no target-version field. The coordinated v2 change
above is therefore a release dependency, not something existing proofs establish.

## What runs inside the verifier

1. Cloud privately stages the immutable encrypted object and checks its digest and
   length against the published capture. Waitron independently hashes and counts the
   exact input it consumes, then authenticates decryption and validates the archive.
   Compare its manifest/time/environment/source node with the bound catalogue input.
   Source Cloud installation provenance comes from the signed publication and
   capture row, not an identity guessed from `trading.env`.
2. Waitron places the database and all declared recovery material in a fresh private
   layout and runs real target migrations there. Preserve an untouched private copy
   for comparisons. Check SQLite integrity and foreign keys before and after migration,
   identities, schema history and each module's obligations. No unknown entry or
   unresolved non-database source can be discarded to obtain success.
3. Each module reads the restored copy through enforced read-only access. Fiscal and
   other immutable records retain their original content and relationships. Owners
   define canonical comparisons across schema changes, covering all evidence fields,
   not merely matching row counts or the newest hashes. Full-chain checks include
   captured stored heads to detect missing tails. Internal consistency does not prove
   completeness against an external registry or an independently lost source.
4. Validate required secret presence, parsing and usability without using operational
   authority. [Required state][w-secrets], lines 15–22, includes `secrets.env`,
   `trading.env` and local TLS CA/server certificate/key pairs. Check key/certificate
   matching and decrypt required application-vault records without signing, issuing
   credentials or contacting services. Distinguish expired operational credentials
   requiring renewal from damaged key material; an unmet data requirement blocks success.
   Captured private keys remain secret input, never result material.
5. Check optional [`backup.env` and `modules.json`][w-optional] under their declared
   absence rules. Validate but exclude the old backup destination from the managed
   recovery layout. Require fresh future Cloud machine/staff authority, with captured
   `cloud-connection.json` and `cloud-staff.*` refused. Never use archived credentials.
   Do not publish a server state directory or create a rebuild marker, pairing or
   activation receipt. No reusable target directory leaves scratch.

Use only the required archive-key version. Cloud's master sealing key, storage admin
credentials, provider tokens and fiscal allocation authority never enter the child.
Current v1 archives embed the application vault key; they do not describe external
key custody. The integration contract's separately versioned
`external-vault-archive-v2` dependency remains required for that case. Missing external
material is unavailable, not permission to fetch secrets or claim a complete restore.
No customer-managed recovery-key custody change is proposed.

Cloud's trusted controller may fetch storage and control its own disposable child.
The verification child has no network, Docker socket, host mounts, server listeners,
replication, scheduled jobs, fiscal/payment/email workers or first-start activation.
Use a read-only pinned image, unprivileged identity, dropped capabilities, bounded
CPU/processes/memory and private quota-limited scratch. Retain the current one-child,
1,024 MiB memory/256 MiB scratch limits and 30-second watchdog; exhaustion means
unavailable. Increasing limits needs separate measured justification.

Close handles and remove scratch, plaintext, decrypted secrets and the owned child
before accepting success. Cancellation, timeout, crash or uncertain cleanup keeps the
attempt unavailable. Reclaim only exact journalled IDs with matching owner, scope,
image and attempt token; never discover ownership by a name alone. Suppress raw
errors, archive filenames/content, environment values and database diagnostics.

## Bind the request to the result

Use a strict versioned private request, `backup-data-restore/v1`. Its binding contains
capture/point ID (currently the same ID), venue and source installation IDs, source
node ID, capture timestamp, archive SHA-256 and byte length, archive manifest/version/
environment and complete module-schema map, backup-key version/reference, target
runtime/release/revision and composition/migration/policy digests, verifier image,
plus job ID, attempt
number, claim ID, controller scope, child token and deadline. These last fields fence
an attempt, meaning a replaced or expired worker cannot publish a late result.

Define `requestDigest` as SHA-256 of a fixed-position versioned JSON array of those
fields, with module maps encoded as sorted key/value arrays. Require exact shapes,
bounded sizes, unique modules and canonical timestamps/integers. The recovery key is
separate secret transport, not part of that array. Archive v1 and existing signed
capture publication need no new public fields for this binding; they do not attest
a source software revision that they never recorded.

The bounded private result returns protocol/request digest, attempt token, measured
archive digest/size, target/policy digests, exactly one result per required module
with its semantics version and fixed check codes, overall status and
`activation: not_attempted`. No customer identity, fiscal identifiers/numbers,
records, key bytes, paths, free-form errors or raw hashes of low-entropy private
values leave the child. Cloud retains the detailed binding privately; public views
expose only the point, timestamps and bounded status/reason copy.

The trusted parent validates every result field, complete coverage, actual image
identity, process termination and cleanup, not merely exit zero or parseable JSON.
An echoed digest is not authentication: accept output only from the recorded child
for the current claim. In one transaction lock the job and point, recheck lease,
claim/token/deadline, unchanged capture metadata/digest/size and target policy, and
that the point is neither deleting nor deleted. Atomically save evidence and update
availability. Reject duplicates, unknown fields and stale output without changing
the point or recording an archive failure. A retry always gets a new attempt token.

## Outcomes and existing consumers

| Proposed result | Meaning and catalogue effect |
| --- | --- |
| `passed` | Every data/secret/module check completed for the bound target; cleanup confirmed. Eligible to become `verified` only after the release gate below. Activation remains unattempted. |
| `invalid` | A completed deterministic check found invalid bytes or required data: digest mismatch, malformed archive, SQLite damage or broken immutable evidence. Record `failed` with a fixed reason; describe integrity failure, not a successful restore. |
| `needs_authority` | A required data verification cannot finish without extra authority. No authority is requested or supplied automatically; unavailable. Separate future activation requirements alone do not trigger this status. |
| `unsupported` | Target incompatibility, missing module, unknown semantics or unsupported archive/secret format. Unavailable; no conclusion that the archive is corrupt. |
| `unavailable` | Missing key, storage failure, cancellation, deadline/resource limit, unexpected exception, invalid result or cleanup uncertainty. No completed archive verdict. |

Unavailable attempts use the existing `backup.verification_unavailable` path, with
bounded private reason evidence. They never create an `invalid` verdict or a
failed-copy alert. A wrong/unavailable decryption key is not labelled corruption
without an independently established correct key. Resource refusal is not corruption.
For a never-qualified point keep `pending`; if a current qualified point cannot be
rechecked, set its current state to `pending` while retaining historical
successful evidence and retention protection. Preserve an existing `failed` verdict
when a later attempt is merely inconclusive. Discard stale attempts entirely.

This needs a Cloud implementation across these traced consumers; changing only the
child would leave unsafe meanings elsewhere:

| Existing consumer at Cloud HEAD | Required change or preserved meaning |
| --- | --- |
| `packages/backups/src/{worker,catalogue}.ts` | Replace `Promise<unknown>`/discarded results and “callback returned means verified” with strict admission. Persist versioned private evidence, target qualification and unavailable reasons through a new registration migration. Current `catalogue.ts:435–438` treats verifier failure/resource/timeout as archive failure; change that classification explicitly. Preserve lease fencing and immutable metadata checks. |
| `packages/backups/src/{waitron-verify-child.mjs,waitron-verifier.ts,container-entry.mjs,container-verifier.ts,verify-process.ts}` | Call the new Waitron interface, carry the complete binding and bounded statuses, preserve isolation and reject generic exit-code success. Update both ordinary and container adapters; older fixtures cannot certify the new contract. |
| `deploy/test-cloud/{backup-worker.mjs,verifier-controller.mjs}`, `deploy/backup-verifier/Dockerfile`, `scripts/build-backup-verifier.mjs` | Pin the implementing Waitron release and verification policy/image; bind controller and job tokens, retain exact ownership and cleanup. Keep deployment unavailable until separately authorised release. |
| `packages/backups/src/{recovery,recovery-request}.ts` (approval, target info/read/restored, catalogue defaults); `replacement.ts` (prepare/current/complete); account wrappers `packages/account-http/src/{recovery,replacement}.ts` | Require current contract/target-qualified `verified` at every snapshot access/recheck, preserving owner, plan, fresh target, expiry and old-server confirmations. Persist the v2 request target descriptor and bind replacement to that recovery operation. A data report grants no fiscal activation. Actual Waitron restore keeps all its existing operation/guard requirements. |
| `catalogue.ts` retention; `packages/account-http/src/backups.ts` fallback protection and default; `packages/registration/src/history-cleanup.ts` | Current availability and historical retention are distinct. Keep last historically successful snapshot protected, even after recheck refusal/failure, and newest before any success; preserve active recovery holds. Historical success must not qualify current recovery. Keep evidence until normal protected-history cleanup permits deletion. |
| `packages/backups/src/{captures,key-operations}.ts`; `packages/registration/src/usage-metering.ts` | Capture publication still starts pending. Key-validation `verified` means key unsealing only, not restore verification. Keep key dependencies and byte/accounting records for unavailable points. |
| `packages/account-http/src/{backups,venue-overview,diagnostics}.ts`; `apps/portal/src/{backup-types,backup-controller,backup-screen,recovery-screen,app,installation-screen,installation-types,diagnostic-types,locale}.ts` | Defaults, buttons and verified timestamps use current qualification. Explain “data restore checked; activation separately authorised”. Display unavailable checks without calling copies corrupt; keep strict response readers aligned if reason fields are exposed. |
| `packages/registration/src/{monitoring,service-alert,email-outbox,account-mail}.ts`; `packages/operations/src/status.ts`; portal alert copy | Failed-copy alerts require completed invalid checks. Inconclusive checks affect pending/staleness and worker status, with bounded operator reasons. No healthy storage result from unqualified historical rows. Keep existing freshness thresholds. |
| `packages/registration/src/{installations,organisation-plans}.ts`, `packages/backups/src/managed-streams.ts`; `deploy/test-cloud/compose.yaml` | Paid entitlement, provisioning/health and verified snapshots remain distinct. `ready` configuration or a fresh signed stream pointer is not an archive restore check. No service-state, free/paid, continuous-recovery or fiscal permission expansion. Keep backup profile `unavailable` and deployment enforcement off now. |

Legacy evidence retains its original meaning and retention protection. Introduce a
single current-qualification rule and apply it to every reader above; do not promote
old rows by a migration default. Update documentation and future proofs in
`scripts/{test-local-backups,backup-verifier-proof,backup-transfer-receipt,worker-scheduling-receipt}.mjs`
and `deploy/test-cloud/{snapshot-proof.test.mjs,test-fixtures/snapshot-client.mjs}`.
Preserve old behavioral/security assertions and saved receipts rather than rewriting
them to appear to prove the new contract.

## Worked contract examples

These are proposed request/result expectations, not executed outputs. All cases use
the same synthetic capture `C`, installation `I`, node `N`, 8,388,608 encrypted bytes,
digest `A`, complete module map `M`, target runtime/revision/policy `T`, and claim/child
token `J1/K1`. The actual request supplies full hashes and opaque IDs, not these labels.

| Request and deliberate condition | Expected result and effect |
| --- | --- |
| Verify `(C,I,N,A,8388608,M,T,J1,K1)`; all owners cover data and secrets, including full fiscal history; no authority input | `passed`, matching measured bytes/request/target digests, every module passed, `activation:not_attempted`. After cleanup and live-claim admission, eligible for current `verified`; recovery still needs its existing owner/target and Waitron activation checks. This success is not yet possible through an implemented interface at the pinned Waitron revision. |
| Same request, input now hashes to `B`; alternatively correct encrypted digest but a genuine module check finds a broken historical link | `invalid/archive_digest_mismatch` before restore, or `invalid/module_integrity` after a completed check. Current point becomes `failed`; retain the older protected snapshot. Do not export the record or private link values. |
| Same request, module declares a necessary data effect that can only be checked by invoking its authorised restore | `needs_authority/module_data_check_requires_authority`. Keep pending/unavailable, preserve bytes; do not supply an allocation or skip the effect. The supplied genuine fiscal refusal belongs to an uncompleted check, not proof of corruption. |
| Same archive, target lacks `fiscal-verifactu`, has older schema support, or lacks any module's verification contribution | `unsupported/module_missing`, `unsupported/target_incompatible` or `unsupported/semantics_missing`. No verified availability, no substitution with `fiscal-none`, no corruption claim. |
| Result for `(C,...,J1,K1)` arrives after retry `(C,...,J2,K2)`, lease expiry, deletion or a target-policy change | Reject as stale at transactional admission. No success, failure or current status mutation from the old result, even if its module checks passed. Clean only its recorded child. |

## Acceptance and release gates

The following are future checks, not checks run for this document. Each owner uses
failing behavioral tests first, then the real implementation and a passing repeat.
In disposable installed copies, omit each named guard independently and require
its associated assertion to fail; restore guards and repeat. Never edit a genuine
archive or protected fixture merely to make its fiscal check pass.

| Owner | Focused acceptance checks and deliberate omissions |
| --- | --- |
| Waitron module/composition/server | Genuine archive places actual data, migrates an older supported schema, validates all required secrets and completes exactly the generated module inventory. Refuse missing modules, unsupported target-only modules, unexplained schema-zero state, unknown semantics, unresolved non-DB state, unsafe/duplicate entries, environment mismatch and missing identity. Omit coverage, compatibility, entry and secret checks independently. Preserve ordinary restore/recovery/first-start behavioral assertions. |
| Waitron fiscal/core/reporting and each data owner | Use disposable genuine fiscal sales/history and saved public evidence; verify whole chains, heads, historical middle/tail corruption, source relationships, logical before/after evidence equality and all declared restore data effects. Omit the full walk, stored-head comparison and immutable comparison independently. A check lacking an independent treatment of a required hook data effect must return `needs_authority`, not pass. Test each module's declaration, including legitimately empty data. |
| Waitron authority boundary | Instrument prohibited operation preparation/allocation, fiscal series/registry/number changes, promotion, signing, first-start activation and workers so any call fails. Require zero calls and unchanged captured fiscal evidence on success and every refusal. Prove ordinary `FISCAL_RESTORE` still refuses without authority and still requires the genuine binding on its authorised path using its existing tests. Remove a read-only restriction and attempt a write inside a verifier callback; require the acceptance check to detect it. No bypass flags or pretend authority in fixtures. |
| Cloud adapters/controller | Against the implementing pinned genuine runtime, require the five worked outcomes plus wrong key, missing external key, malformed/truncated/duplicate result, forged success, wrong image, timeout/OOM/scratch exhaustion, cancellation, worker death and uncertain create/cleanup. Independently omit each binding comparison, lease fence, output validation, module coverage, ownership and cleanup guard. Require network/socket/host access and activation probes to be refused; inspect only owned resources and confirm no plaintext survives. |
| Cloud catalogue/API/portal/monitoring and Waitron recovery client | Exercise unavailable versus invalid through real job and database transactions, including a formerly verified point, old unversioned rows, historical retention protection, unavailable recheck and stale success after a new claim. Reject absent/v1 or changed target descriptors on this new snapshot path and a target binary changed after approval. Omit current-qualification gates separately in approval, delivery, replacement and local pre-placement comparison; require denial assertions to fail. Check defaults, buttons, timestamps, alerts, operations health, downgrade policy and ordinary/continuous recovery stay truthful. |

Only after owner design approval, the separately owned Waitron and Cloud implementations,
complete module-owner coverage, reviewed pinned releases and the genuine end-to-end
capture/publication/data-restore/admission proof may Cloud publish current verified
availability for an individual point. Run that proof with the continuous source
absent to establish independent snapshot recovery. The report never replaces the
separate authorised activation proof or permits route movement/trading.

For D79, also retain its whole-branch review, required package/consumer checks and
current-head CI/release gates before readiness. Nothing here enables the dormant
backup deployment profile, plan enforcement, providers or fiscal authority. At the
current pin the new Waitron verification and version-bound recovery interfaces,
complete module checks and successful genuine verification are unresolved
implementation dependencies, so snapshots remain unavailable.

[w-restore]: https://github.com/clintongormley/waitron/blob/e52c997c02d2fcd66d0e7239cbfd79ced4ddd0ee/apps/server/src/restore.ts
[w-hook]: https://github.com/clintongormley/waitron/blob/e52c997c02d2fcd66d0e7239cbfd79ced4ddd0ee/packages/module/src/restore.ts
[w-allocated]: https://github.com/clintongormley/waitron/blob/e52c997c02d2fcd66d0e7239cbfd79ced4ddd0ee/packages/fiscal-verifactu/src/allocated-lifecycle.ts
[w-fiscal-restore]: https://github.com/clintongormley/waitron/blob/e52c997c02d2fcd66d0e7239cbfd79ced4ddd0ee/packages/fiscal-verifactu/src/restore.ts
[w-composition]: https://github.com/clintongormley/waitron/blob/e52c997c02d2fcd66d0e7239cbfd79ced4ddd0ee/packages/composition/src/modules.ts
[w-preview]: https://github.com/clintongormley/waitron/blob/e52c997c02d2fcd66d0e7239cbfd79ced4ddd0ee/apps/server/src/recovery-backup-preview.ts
[w-chain]: https://github.com/clintongormley/waitron/blob/e52c997c02d2fcd66d0e7239cbfd79ced4ddd0ee/packages/fiscal-verifactu/src/verify.ts
[w-closes]: https://github.com/clintongormley/waitron/blob/e52c997c02d2fcd66d0e7239cbfd79ced4ddd0ee/packages/reporting/src/verify-daily-close-chain.ts
[w-manifest]: https://github.com/clintongormley/waitron/blob/e52c997c02d2fcd66d0e7239cbfd79ced4ddd0ee/apps/server/src/backup-manifest.ts
[w-gate]: https://github.com/clintongormley/waitron/blob/e52c997c02d2fcd66d0e7239cbfd79ced4ddd0ee/apps/server/src/restore-gate.ts
[w-secrets]: https://github.com/clintongormley/waitron/blob/e52c997c02d2fcd66d0e7239cbfd79ced4ddd0ee/apps/server/src/state-secrets.ts
[w-optional]: https://github.com/clintongormley/waitron/blob/e52c997c02d2fcd66d0e7239cbfd79ced4ddd0ee/apps/server/src/backup-optional-state.ts
[w-cloud-recovery]: https://github.com/clintongormley/waitron/blob/e52c997c02d2fcd66d0e7239cbfd79ced4ddd0ee/apps/server/src/cloud-recovery.ts
[w-module]: https://github.com/clintongormley/waitron/blob/e52c997c02d2fcd66d0e7239cbfd79ced4ddd0ee/packages/module/src/module.ts#L1293-L1315

## Owner decision

The owner approved this contract and its separately owned verification and
recovery-version interfaces on 18 October 2026 at approximately 10:10. Waitron's
implementation is A850 in lane E, after A679; Cloud integration follows after
A850 lands. Approval grants no fiscal activation authority and does not establish
runtime success. Keep snapshots unavailable and deployment enforcement off until
the implementation, evidence and release gates above pass.
