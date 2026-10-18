# Test Cloud Free/Paid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for the already authorised native inline execution. Steps use checkbox (`- [ ]`) syntax for tracking. The parent supplies a fresh builder check before the separate documentation landing; this planner neither implements nor lands.

**Goal:** Run an isolated LAN test Cloud with two organisations and real per-service free/pretend-paid enforcement, with truthful limits on unavailable integrations.

**Architecture:** Store one organisation plan independently of installation setup and enforce it at the service and data-access boundaries. Add an opt-in LAN HTTPS deployment using project-private state and existing local service adapters. Keep signed Waitron contracts and independent launch gates unchanged.

**Tech Stack:** Node 26, TypeScript, PostgreSQL, pnpm 9.15, Docker Compose ≥2.24.4, local TLS CA, SeaweedFS, WireGuard/HAProxy, Mailpit; existing pinned Waitron client/verifier fixtures.

**Spec:** [2026-10-17-test-cloud-free-paid-design.md](../specs/2026-10-17-test-cloud-free-paid-design.md).

## Global Constraints

- Base `143c3f794b164b4c725ad8c0e8bf894968ecfbab`; re-read changed source when rebasing. Plan observations pin Waitron main `e52c997c02d2fcd66d0e7239cbfd79ced4ddd0ee`.
- This first PR contains the spec, this plan and `docs/backlog.md`. Subsequent numbered production PRs each leave main working independently; do not combine all slices or create CI-only proof PRs.
- Project `waitron-cloud-test`; host `clinton@waitron.local` / `192.168.10.10`; canonical origin `https://waitron.local:3000`. LAN only. No box mutation in this planning pass.
- Never start/restart/upgrade/reseed/touch the quarantined box Waitron venue or another lane's worktree. Use disposable Mac venues and this lane's scratch; read Waitron main only.
- Enforce plans only with validated `CLOUD_TEST_SERVICE_PLANS=1`, explicitly passed to stores/workers as `planMode`; default `0` preserves ordinary deployments. Enabled mode refuses non-test venues. Do not enable the deployment flag until PRs 1–7 and the complete local integration proof pass. Intermediate PRs remain dormant. No customer cancellation or production retention policy.
- Free: address eligibility, account email, Translate all eligibility. Paid adds continuous backup, retained snapshots/recovery and remote access. Readiness, provisioning, consent and entitlement remain distinct.
- Fiscal registry is out of scope. Paid must not enable fiscal writes or touch fiscal records. Preserve signed schemas/actions/expiry, three/four-service negotiation, ownership-first cursors and the 16,777,216-byte decoded collect bound.
- Address providers disabled; translation deployed off pending pinned joint paging proof and owner Tasks 22–24 after 2026-11-02; relay opt-in local proof, Mailpit only. No real model/provider calls. Preserve archived translation prompts, trial data and prices.
- Generate runtime secrets only inside private Docker volumes. Build linux/amd64 on Mac using BuildKit token secrets; stream images over SSH. No generated secret or `NODE_AUTH_TOKEN` in host files, logs or image layers.
- Proposed capacity defaults: start ≥4,096 MiB available RAM / 20 GiB disk; floors 2,048 MiB / 15 GiB. Steady Cloud ≤2,048 MiB plus one 1,024 MiB verifier, 256 MiB scratch included; fixture data ≤1 GiB. Stop only Cloud IDs recorded by this lane.
- Each code slice uses observed failing behavioural tests before minimal implementation, then removes each critical guard in a disposable installed copy and observes failure. Never weaken assertions or security tests.
- No repeated permission gate. An incompatible Waitron wire requirement is a genuine parent/owner decision; implementation convenience is not.

## Review Focus

1. A committed downgrade racing cached replies or provider waits must not return fresh paid credentials (PRs 1–2).
2. An old stream writer or staged gateway route must lose real access; filtering a status screen is insufficient (PRs 3 and 5).
3. TLS/proxy setup must reject wrong Host, wrong Origin and untrusted certificates while ordinary loopback and production guards still pass (PR 4).
4. Retrying a free service must preserve consent, quotas, ownership and read/release exceptions without enabling a provider (PR 6).
5. Restart/rollback or resource exhaustion must preserve project identity and leave quarantined Waitron unchanged (PRs 4, 5 and 7).

---

## Delivery and verification shared by every PR

Land the documentation first. For each code PR, execute its red/green cycle, preserve original assertions, and update the relevant guide plus `docs/backlog.md` with what is proved and still unavailable. Sign off every commit with `git commit -s`; run normal hooks.

Before **every push**, run full suites for touched packages and all their source/workspace dependants using the current `scripts/ci-scope.mjs` graph. Registration changes reach its service/API/portal consumers; account-http changes reach portal/UI consumers. Use `node scripts/test-postgres.mjs --filter <package> test` for each selected package. Root configuration, lockfile, `scripts/` or `.github/` changes require `pnpm test` for the whole workspace. Run typecheck/build when the slice changes those inputs. Record test counts and meaningful guard-removal results; do not duplicate broad runs without new changes/failures.

Each meaningful production branch gets one Claude run-it review through `claude-seat.sh review-run` in a throwaway installed candidate after its initial rebase, using finish-branch. Triage completed findings in the feature checkout. Retain approval across later rebases, inspect and validate the new result. Wait for exact-head CI and inspect every actual job, including checkout/reuse evidence. Declare expected/actual CI minutes; no throwaway CI PRs. Hold the shared `~/waitron-campaign-shared/main.lock` for the whole land operation, fetch and require current main to be an ancestor of the green head, then follow land-branch. Read every job on exact-merge CI under H12, or explicitly checkpoint it for readback. The parent owns campaign receipts; never put them in the repo.

### Docs PR: Land the checked design and plan

**Files:** this plan, its spec and `docs/backlog.md`.

Planner validation at the pinned base: `node --test scripts/ci-docs.test.mjs scripts/ci-plan.test.mjs` passed 13/13. Checking `auditDocumentation(HEAD)` from `scripts/ci-docs.mjs` reported **Executable inputs changed since the document audit**. The real planner with an in-memory view of these two uncommitted documents selected all 17 package jobs, not documentation-only work. No Git objects/commits or audit files were written. Parent must account for that fallback before pushing; this planning pass does not repair CI or authorise skipping required jobs. Text encoding, final newline, NUL and trailing-whitespace checks passed for both artifacts.

- [ ] Parent performs the fresh builder check against current code; reconcile concrete gaps in these artifacts.
- [ ] Run `node --test scripts/ci-docs.test.mjs scripts/ci-plan.test.mjs`, plus the actual candidate's audited documentation planner/checker. Expect all three paths selected, or report a stale-audit full fallback honestly; do not edit CI/audit files in this PR.
- [ ] Use docs-only finish/land with focused validation, normal hooks, exact-head all-job checks and H11/H12. No production run-it review or deployment. Begin PR 1 only after landing.

### PR 1: Persist the organisation plan and operator command

**Files:** create `packages/registration/src/organisation-plans.ts`, `organisation-plan-cli.ts`, `test/organisation-plans.test.ts`, `test/organisation-plan-cli.test.ts`; add the next migration, expected `migrations/042_organisation_service_plans.sql`; modify `src/migrate.ts`, `src/index.ts`, migration-count/manifests in existing schema tests as required. Add the operator section to `docs/local-deployment.md` and update `docs/backlog.md`.

**Interfaces:** export `OrganisationPlan = 'free' | 'paid'`, `PlanService = 'address_lookup' | 'transactional_email' | 'content_translation' | 'continuous_backup' | 'retained_snapshots' | 'remote_access'`, `OrganisationPlanView = {organisationId:string;plan:OrganisationPlan;revision:number;changed:boolean}`. `PlanMode = 'existing' | 'test-free-paid'`; `requirePlanService(client:PoolClient, organisationId:string, service:PlanService, mode:PlanMode): Promise<void>` is a no-op only in `existing` mode and otherwise requires the stored plan. Trusted callers separately bind and reject non-test venues in enabled mode. `OrganisationPlanStore(pool).show(id:string)` and `.set(id:string, plan:OrganisationPlan): Promise<OrganisationPlanView>`; `readOrganisationPlan(client:PoolClient, organisationId:string): Promise<OrganisationPlan>` holds a shared policy lock; `planAllows(plan:OrganisationPlan, service:PlanService): boolean`. Service callers translate denial to their existing public error. No fiscal service value.

- [ ] Write `free_is_default_and_paid_adds_only_backup_and_remote`, `set_is_atomic_idempotent_and_scoped`, `cli_rejects_unknown_org_bad_plan_and_stale_schema`, and `plan_updates_do_not_enable_fiscal_runtime`. Assert exact free/paid matrix, revision increment only on change, two organisations remain separate, no credential output and no partial update on database failure. Test concurrent first/set calls with real PostgreSQL. Add `ordinary_mode_preserves_existing_behaviour`, `test_mode_rejects_production_venue`, and `cli_requires_explicit_test_mode`; reject malformed flags without mutation.
- [ ] Run `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/organisation-plans.test.ts test/organisation-plan-cli.test.ts`; observe the expected missing-interface/schema failures, not environment failures.
- [ ] Add only the two organisation columns and CLI/store. CLI grammar/output is the spec's show/set example; validate the full migration ledger and bound database waits using `relay-control-cli.ts` as the pattern. Add a validated mode option and CLI opt-in guard, with no public endpoint. The normal runtime keeps it off. Plan changes do not provision services. Later PRs add their transition work atomically to the setter.
- [ ] Re-run focused tests to green; remove paid/default/schema/tenant guards one at a time in a disposable installed candidate and record failing named assertions. Update migration manifests without changing landed SQL. Run the shared finish/land sequence. This PR delivers the operator primitive, not a claim that all services enforce it yet.

### PR 2: Enforce backup permission and current configuration authority

**Files:** modify `packages/registration/src/{organisation-plans,installations}.ts`; `packages/backups/src/{captures,catalogue,managed-streams,recovery,recovery-request,replacement,worker}.ts`; `packages/account-http/src/{managed-streams,backups,recovery,replacement,captures}.ts` where public errors need mapping. Extend the matching existing tests and add `packages/backups/test/plan-permissions.test.ts`. Add explicitly opted-in paid fixtures while preserving existing ordinary-mode fixtures, `docs/local-backups.md` and `docs/backlog.md`.

**Interfaces:** consume PR 1 policy and explicitly passed `planMode` under a documented lock order, then existing installation/location fences. Existing machine/restore signatures and bodies stay unchanged. Add internal `advancePlanConfiguration(client:PoolClient, organisationId:string, downgrade:boolean): Promise<void>` in registration to advance each affected installation exactly once and clear paid setup on downgrade in the setter's transaction.

- [ ] Write failing cases `free_cannot_provision_reserve_publish_or_rotate`, `free_cannot_configure_observe_stream_or_obtain_recovery_keys`, `downgrade_blocks_target_read_and_replacement_completion`, `metadata_and_close_survive_downgrade`, `cached_machine_reply_never_reissues_paid_configuration`, `provider_wait_rechecks_downgrade`, `downgrade_preserves_last_verified_snapshot`, and `plan_lock_order_survives_pairing_replacement_and_two_installations`. Assert existing permission codes, zero grant calls/keys on refusal, unchanged retained objects, current configuration revisions and no deadlocks using real transaction barriers.
- [ ] Run `node scripts/test-postgres.mjs exec pnpm --dir packages/backups exec node --test test/plan-permissions.test.ts test/recovery.test.ts test/managed-streams.test.ts`, then the existing `packages/registration/test/installations.test.ts` and `packages/account-http/test/captures.test.ts` through the same runner with their package directories. Observe free incorrectly admitted or cached configuration exposed before adding guards.
- [ ] Add paid checks to all public and trusted backup entry points, including both phases around storage waits. Authenticate/bind before policy; no bypass via direct catalogue calls. Apply permission to both newly built and durable replayed installation views, including renew/report; keep version negotiation and translation reader exclusions. Add setup revision/clearing transition and account status masking. Audit new lock acquisition against existing session/member/installation/recovery paths before changing it.
- [ ] Gate new recovery/data/key access and replacement; retain owned metadata/status/close access. Permit verification of admitted points and abandoned-staging cleanup; pause retained-snapshot expiry only in the opted-in test deployment while free, without deleting data; ordinary-mode retention stays unchanged. Do not use billing cancellation semantics. Add `upgrade_reprovisions_existing_location_and_stream_binding`: refresh cleared setup/current stream revision explicitly, including prior-location no-op branches, preserving objects, keys and existing recovery operations. Preserve original assertion meanings by marking old paid fixtures paid.
- [ ] Run focused cases to green, remove each admission/recheck/replay/expiry guard in a disposable installed copy, then run required package/dependant suites and finish/land. Existing HTTP codes must map cleanly; no new wire schema.

### PR 3: Enforce remote permission through signed gateway export

**Files:** modify `packages/remote-access/src/{placement,reconciler,staff-exchange}.ts`, `packages/account-http/src/remote-access.ts`; extend `packages/remote-access/test/{placement,controller,movement,reconciler}.test.ts` and `packages/remote-access/test/staff-exchange-fixture.ts`; create `packages/remote-access/test/plan-permissions.test.ts`. Update `docs/local-remote-access.md` and `docs/backlog.md`.

**Interfaces:** use PR 1 policy/mode and PR 2 revision transition. Ordinary-mode remote behaviour stays unchanged. Preserve `RemoteAccessStore`/certificate/move signatures, `GatewayManifest` v1 and its 600,000 ms maximum authority. Existing remote account permission errors remain.

- [ ] Write `free_cannot_place_move_rename_or_get_certificate`, `downgrade_removes_active_and_staged_routes`, `reconciler_cannot_publish_or_complete_stale_paid_work`, `upgrade_requires_explicit_reprovision`, and `gateway_drops_last_paid_route_at_authority_expiry`. Include another paid organisation that remains routed, certificate signing delayed across downgrade and a reconciler restart.
- [ ] Run `node scripts/test-postgres.mjs exec pnpm --dir packages/remote-access exec node --test test/plan-permissions.test.ts`; observe free/stale routes currently admitted.
- [ ] Check policy on placements, staged/readied/completed moves, names, certificate authorization/publication and submit/status. Derive manifests and reconciler desired digests from the same current eligible set. Include setup state so paid alone cannot restore cleared routes; explicit reprovision must also refresh an existing placement instead of taking its current no-op return. Remove downgraded peers/work while keeping existing expiry/sequence protection and no new public exposure.
- [ ] Re-run focused tests and real gateway expiry/isolation fixture to green; remove each filter/recheck in a disposable installed copy. Complete required suites and finish/land. Withdrawal timing is observed separately from the plan setter's success.

### PR 4: Add isolated LAN HTTPS deployment and safe image transfer

**Files:** create `deploy/test-cloud/{compose.yaml,test.env,proxy.cfg,bootstrap.mjs,bootstrap.test.mjs,deployment.test.mjs}`; modify `deploy/local-stack/{runtime.mjs,runtime.test.mjs}` only to accept a validated canonical origin for account and mail while keeping its default; create `deploy/test-cloud/{capture-mailer,email-worker}.mjs` and their tests, with explicit email-runtime selection; create `scripts/test-cloud-deploy.mjs`, `scripts/test-cloud-deploy.test.mjs`. Add `docs/test-cloud.md`; update `docs/local-deployment.md` and `docs/backlog.md`. No edits to account security guards.

**Interfaces:** `createTestCaptureMailer({origin,port})` renders existing `accountMail` templates, validates the exact test HTTPS origin and sends only to the test Mailpit listener fixed at loopback in its shared namespace; no configurable SMTP host and no production selection. Both existing mailer validators remain unchanged. The test runtime explicitly selects `email-worker.mjs`, which loads private runtime configuration, checks the schema and uses the existing `EmailWorker`/`runWorkerLoop` with this capture mailer; it never changes the ordinary email CLI. Override project is always `waitron-cloud-test`; public configuration is host/origin/ports/image digest, never credentials. Deployment CLI modes `preflight | load | up | status | stop` use recorded project IDs and `--no-build`. `load` accepts an image stream built for linux/amd64 on the Mac. Bootstrap writes CA/leaf keys, configuration and passwords only into the configuration volume; certificate export returns public CA only. Preserve default local lifecycle commands.

- [ ] Write `lan_override_exposes_only_selected_interfaces`, `canonical_https_origin_reaches_mail_pairing_and_health`, `signup_mail_uses_canonical_lan_link_and_fixed_capture_sink`, `ordinary_mailer_still_rejects_lan_origin`, `proxy_rejects_wrong_host_origin_and_forwarding_spoof`, `certificate_is_trusted_and_bound_to_waitron_local`, `private_state_survives_restart_without_host_secret_files`, and `preflight_or_rollback_never_targets_waitron`. Assert internal backend has no published port, DB/Mailpit remain loopback, rendered ports replace rather than append, translation stays off, build credentials never enter deployment inputs and insufficient resources run no mutation command.
- [ ] Run `node --test deploy/test-cloud/*.test.mjs scripts/test-cloud-deploy.test.mjs`; observe missing deployment behavior. Use local Docker/TLS for actual trust/binding cases, not just source-text assertions.
- [ ] Implement the override/proxy, explicit capture mailer and origin propagation, matching the spec's addresses. Require supported Compose rendering and fresh read-only host inventory. Generate private CA material in-volume, provide explicit proxy trust/forwarding rules, and validate normal loopback and production security suites unchanged. The script builds nothing remotely and never captures full private `docker inspect`/environment output.
- [ ] Test start/restart/failure/stop in a separate disposable **Mac** project, including project-ID validation, occupied-port rejection, CA persistence and a resource-floor failure. Keep image IDs/limits/log rotation and cleanup receipts. Run focused tests to green, remove each critical origin/project/resource guard in a disposable installed copy, run whole-workspace checks because `scripts/` changed, and finish/land. Do not deploy to the box yet.

### PR 5: Supply real local backup and remote adapters for the test project

**Backup verification dependency:** the owner approved the
[separate verification contract](../specs/2026-10-18-backup-verification-without-fiscal-authority.md)
on 18 October 2026. Waitron A850 landed in
[#1939](https://github.com/clintongormley/waitron/pull/1939) at
`5516dd57e9ae4c52e1a68f35f1e1860ff00e2faa`. Continue PR5 with the
[Cloud verification implementation plan](2026-10-21-cloud-backup-verification.md),
which binds the landed interface to Cloud's result admission, catalogue and recovery
readers. This plan publication adds no PR5 service code. Keep snapshots unavailable
and deployment enforcement off until the genuine proof and release gates pass.
Ordinary fiscal activation authority is unchanged.

**Files:** create `deploy/test-cloud/{storage-authority.mjs,storage-authority.test.mjs,service-runtime.mjs,service-runtime.test.mjs}`; extend its bootstrap/Compose/proxy as needed. Reuse interfaces in `packages/backups/src/{capture-config,managed-streams}.ts`, `packages/remote-access/src/{placement,reconciler,operator-cli}.ts`, and scope patterns in `scripts/backup-storage-fixture.mjs`, `scripts/test-local-{backups,remote}.mjs`. Any package adapter edits carry corresponding package tests. Update `docs/test-cloud.md` and `docs/backlog.md`.

**Interfaces:** persistent local implementation of `CaptureOptions` and `ManagedStreamAuthority`, including its optional recovery reader; advertise `https://waitron.local:8333`. Keep identities, issuer and provider references in private volumes. Add internal `withdrawWriter(venueId:string): Promise<void>` to this local adapter and a restart-safe reconciler that compares current plans; no Waitron action or credential-field change. Use existing gateway/certificate interfaces with volume-backed inputs instead of the base empty-route publisher.

- [ ] Write `paid_real_archive_and_stream_use_distinct_scoped_credentials`, `free_never_gets_storage_authority`, `pending_downgrade_withdraws_writer_after_restart`, `old_writer_fails_after_withdrawal_and_upgrade_mints_fresh`, `snapshot_sts_validates_expiry_and_storage_rejects_after_expiry`, `lan_storage_endpoint_and_ca_work_from_client_and_container`, and `paid_lan_gateway_routes_and_peer_are_removed_on_downgrade`. Assert neighbour isolation and actual storage/gateway refusal; check before/after a blocked provider response. Check the requested/validated expiry locally. The real post-expiry observation is a bounded operator proof outside the five-minute CI jobs; record its actual timestamps/refusal, not an accelerated host-clock claim.
- [ ] Run the new local adapter tests against disposable SeaweedFS/WireGuard/HAProxy. Observe default stack's absent client authority/empty routes and continued old writer access. Do not replace this red evidence with a fake store returning success.
- [ ] Extract/adapt the existing local proof mechanisms without exporting storage admin secrets. Persist writer/reader identities separately and reload only the owned SeaweedFS IAM configuration on withdrawal; retry pending withdrawal after restart. Preserve recovery readers privately, prevent new free grants, and measure bounded old STS exposure. Wire account backup authority, a scoped verifier image/controller and the test remote reconciler with local CA/DNS inputs. Leave ordinary local stack/profiles unchanged; gateway health must no longer assume zero routes in this opt-in project.
- [ ] Re-run real boundary tests and restart/withdrawal proofs to green; remove critical plan/scope/withdrawal guards in a disposable installed copy and observe failures. Audit verifier child labels/IDs and all Docker actions against the quarantine restriction. Finish with whole-workspace suites if scripts changed, otherwise all touched/dependant packages; finish/land. If existing wire cannot support the proof, give the parent the exact incompatibility instead of designing a new action.

PR 5 checkpoint: persistent storage/account authority, real fifteen-minute expiry,
volume-backed remote reconciliation and the delivered gateway's live certificate
replacement/downgrade/restart proofs now pass. The backup worker selects the canonical
storage endpoint and LAN CA in enabled mode. Its scoped verifier/controller, pinned
Waitron image and paid snapshot verification remain before PR 5 review and landing.
The scoped controller and file-backed archive adapter are implemented and locally
tested. Genuine snapshot capture/publication reaches the pinned Waitron fiscal
restore hook, which refuses `sif.allocation_invalid`; the verifier supplies no
authorised allocation operation. PR 5 is blocked pending an explicitly agreed
verification contract. The owner selected a separate contract that grants Cloud
no fiscal authority. The [design proposal](../specs/2026-10-18-backup-verification-without-fiscal-authority.md)
needs approval and a Waitron implementation before Cloud adapter work can use it.
Do not skip that hook or grant fiscal writes implicitly.
The backup profile remains unavailable. Deployment enforcement stays off.
Current runner instructions assign required package
suites to CI and retire this plan's earlier local-full-suite and CI-cost instructions.

### PR 6: Pin free-service proof and honest availability

**Files:** extend `packages/registration/test/{relay-grants,relay-worker,relay-control,content-translation-service}.test.ts`, `packages/translation/test/{machine,worker,collect-page}.test.ts`, `packages/account-http/test/{relay-disabled,content-translation-readers}.test.ts` and `packages/translation/test/fake-openai.ts` as needed. Add `scripts/test-cloud-free-services.mjs`, `scripts/test-cloud-free-services.test.mjs` and redacted receipt validation; update `docs/test-cloud.md`, relay contract and backlog only where the new proof supplies evidence.

**Interfaces:** no new provider or Waitron wire API. Proof receives two organisation/installation fixtures and a capture-only SMTP endpoint. Relay uses explicit `mode: 'local-proof'` and a verifier bound to that disposable venue's origin, test CA and challenge; translation proof has its own isolated account process/fake provider. Deployed `CLOUD_TRANSLATION=0` and default relay-disabled startup remain unchanged.

- [ ] Add failing assertions only for missing D79 coverage: `both_plans_capture_cloud_account_mail`, `paid_does_not_create_email_grant`, `relay_rechecks_revocation_at_handoff_without_remote_service`, `translation_plan_toggle_preserves_retry_and_read_release_exceptions`, and `deployment_never_enables_translation_or_address_providers`. Keep existing negative consent/cap/cursor tests and the four-off-routes `503 temporarily_unavailable` assertions.
- [ ] Run `node scripts/test-postgres.mjs exec node --test scripts/test-cloud-free-services.test.mjs` and the named package test files with `pnpm --dir <owning-package> exec node --test <test-path>` through the same runner. Observe each missing orchestration/validation behavior before adding its helper. Avoid production edits where existing behavior already satisfies the assertion; regression coverage may already pass and needs no manufactured red change.
- [ ] Implement only bounded fixture orchestration/receipt validation needed to prove the matrix. Fake translation uses a local provider, fake key and egress restriction; no archived prompt/price changes. Do not add a paid-only check to status/collect/release or return permission before submit's existing idempotent-retry check. Relay does not infer consent from remote access, and captures mail only in project Mailpit.
- [ ] Prove false/foreign origin evidence, expired grants, ownership changes, stopped relay, missing translation consent, cap exhaustion, foreign jobs/invalid cursors, full-page byte bounds and release/expiry between pages still fail appropriately. Remove critical guards in a disposable installed copy; run required suites and whole workspace for script changes; finish/land. State that current Waitron main still has no Cloud relay transport or qualified paged translation client.

### PR 7: Complete Mac integration proof, runbook and bounded box deployment

**Files:** add `scripts/test-cloud-integration.mjs`, `scripts/test-cloud-integration.test.mjs`, `scripts/verify-test-cloud-receipt.mjs` and its test. Update `docs/test-cloud.md`, `docs/local-deployment.md`, `docs/backlog.md` with actual results/limits. Use genuine clients from a pinned installed Waitron main snapshot in own scratch, reusing `scripts/test-waitron-pairing.mjs`, `scripts/milestone-proof-helpers.mjs` and existing capture/recovery fixtures; never edit Waitron's repository.

**Interfaces:** receipt records Cloud/Waitron/image revisions, test environment, two organisations, observed service/refusal results, withdrawal durations, resource samples and exact owned resource cleanup. It contains no tokens, private keys, grant payloads, menu bodies or email action links. It must distinguish `proved`, `unavailable` and `not-run` instead of treating all three as success.

- [ ] Write `receipt_rejects_missing_real_client_or_missing_denial`, `receipt_cannot_call_fake_translation_live`, `receipt_requires_unchanged_quarantined_ids_and_capacity_samples`, and `rollback_preserves_project_identity`. Run the focused script tests and observe rejected incomplete/false receipts before minimal proof orchestration.
- [ ] On the Mac, start distinct disposable Waitron test venues in demo mode, separate state directories and exact HTTPS Cloud destination/CA. Through actual pairing/lease/configuration helpers, connect normal signup-created free and paid organisations. Prove account mail on each; free snapshot reserve prints `403 permission_denied`, paid uploads/verifies/restores a real archive and tests stream recovery plus independent snapshot fallback, without trading activation. Prove free remote refusal, paid LAN route isolation and paid-to-free real withdrawal. Record protocol outputs, not claimed service readiness.
- [ ] Record translation/relay fixture proofs separately; keep deployed translation off and address lookup unavailable. Repeat only against a future pinned Waitron paging candidate when its owner supplies it; no go-live before the existing joint/owner gates. Do not invent a Waitron relay caller to satisfy the receipt.
- [ ] Complete script fault controls, whole-workspace local suites, review and exact-head checks, then land this working proof/runbook PR under H11/H12. No throwaway deployment-proof PR.
- [ ] The later deployment driver rechecks host identity, Compose version, ports/resources and the three quarantined IDs read-only; builds pinned linux/amd64 Cloud/verifier images locally with BuildKit secret and streams them over SSH. Deploy only the reviewed Cloud project with `--no-build`, migration backups in private volumes and the spec's limits. Only after the complete local proof passes, enable `CLOUD_TEST_SERVICE_PLANS=1` for all test API/worker roles in the reviewed release. Create free/paid test organisations through normal account flows and run the operator plan command inside the project. Record that ordinary mode remains off elsewhere.
- [ ] Run the genuine disposable **Mac venue** proof against the box Cloud destination; do not connect or alter the box venue. Observe health of bootstrap/migration jobs and all selected long-running services separately from each integration. Sample at five seconds through the sixty-second settled window and active backup verification. If thresholds or Waitron health fail, stop only recorded Cloud IDs and preserve private volumes; record the blocker.
- [ ] Finish the runbook with exact connection/trust/plan commands and redacted observed refusals, measured capacity and safe restart/upgrade/rollback. State outside-home remote access, address lookup, live translation and Waitron relay limitations plainly. Parent records deployment evidence and any exact-merge readback, and reports D79's achieved scope and remaining client/release dependencies without claiming those services work live.

## Self-review and handoff

The spec maps to PR 1 (plan primitive), PR 2 (configuration/backups/recovery/housekeeping), PR 3 (remote authority), PR 4 (TLS/isolation/capacity), PR 5 (real adapters/direct access withdrawal), PR 6 (free-service exceptions/gates) and PR 7 (proof/operations). All five Review Focus conditions have named behavioral assertions. Proposed interfaces are internal; no implementation bodies or new Waitron actions appear here. The parent should resolve any implementation-file drift in its fresh builder check, then continue the authorised native workflow without another permission request.
