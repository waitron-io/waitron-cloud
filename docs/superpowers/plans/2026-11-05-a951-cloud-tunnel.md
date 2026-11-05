# A951 fixed-box Cloud tunnel implementation plan

> **For agentic workers:** Use `superpowers:executing-plans` inline, following the owner's routine implementation preference. Read `superpowers:test-driven-development` before writing code or tests. Track the checkbox tasks below; this publication executes none of them.

**Goal:** Build Cloud's half of one fixed-box, opt-in test STAFF certificate and tunnel fixture, keeping every unqualified path CLOSED.

**Architecture:** Keep appliance encoding, authenticated decision consumption, durable ledgers and purpose-specific signing separate from existing installation and staff-v1 exchanges. E supplies local authorization, protected state and host enforcement; Cloud supplies its independent owner check, authenticated approval receiver and durable Permit/result consumption. Connect only an accepted complete contract, shared signed corpus and explicitly pinned consumer pair.

**Tech stack:** Existing TypeScript, Node >=26, `node:test`, Hono, `pg`, PostgreSQL and pnpm 9.15.0; existing package-local `src/` and `test/` conventions. Native Debian 13 work belongs to E/G7.

**Spec:** [Complete G1 mapping](../specs/2026-11-02-a951-g1-host-custody-mapping.md), all 614 lines, especially §§2–9; [Cloud contract](../../waitron-integration-contract.md), A951/D123/D130/D132/D136/D560 and staff-v1; [documentation ownership](../../documentation-ownership.md); the owning D560/D582 passage in [the backlog](../../backlog.md).

## Constraints and current evidence

- Owner authority covers design/planning and local build only. Publish this plan and its owning backlog passage as documentation before implementation; this publication supplies no executable consumer or runtime proof.
- Later build instructions are conditional future work. No AWS/provider action, spending, deployment, customer mail, physical-host modification or Waitron change follows from this plan.
- The watcher selects each next slice and coordinates its landing. Keep current campaign status outside the repository; each slice remains independently landable with admission CLOSED.
- First target is ONE FIXED BOX, test STAFF and an isolated non-business probe only. No G5 movement/replacement or G4 customer upstream; no full staff application until separate origin/device/session/passkey qualification.
- Debian 13 on the reinstalled test box is the owner's direction. E writes its host-profile successor; write no Ubuntu successor and use no EC2 workaround. Actual measurements, loaded-byte pins and host acceptance remain E/G7 inputs.
- Admission remains CLOSED until actual path-scoped G1–G7 qualify. An isolated fixture can qualify only its recorded test paths, never production admission. `.local`, local CA and LAN/WAN independence remain intact; add no location concept.
- Preserve every immutable mapping/proposal byte and digest. Mapping `cloud-a951-g1-host-custody-v1` / `proposal-2026-11-02.1` SHA-256 is `2f16bd7c01c12849897501fae3bccabb770f9db4006e917b9964573bf994a9cf`, including final LF; read-only `shasum -a 256` confirmed it during planning.
- Preserve the original production manifest's 83 ASCII bytes, no final LF, revision `proposal-2026-10-23.1`, SHA-256 `271fefd892b2c0f10ffab42f8e4a832a163b244733285f08d5a0ea1dfab1b012`; production customer routes stay empty.
- Change no fiscal authority, expectations, landed migrations or existing checks in this documentation branch. Later schema additions use new migrations and regenerate their numbers at execution.
- All **new filenames, TypeScript names, signatures and internal return records below are PROPOSED**, subject to the accepted engineering return. They are not new wire fields, endpoints, UI or claims of shipped behavior. Existing names and quoted artifact names retain their source meanings.
- No routine engineering choice needs owner approval. Return genuine security/product conflicts through the watcher with the conflicting requirements and affected scope; never choose a weaker contract silently.

## Source pins and responsibility boundary

Cloud inspection pin C is `4018e9cff8a10f4cf02b33e823bd52a5b2bee26b`; mapping historical review base remains `b522fa943a15badafbb4e88e9e7c637f2bd58d51`. Waitron current inspection pin W is `9b2adbf7dbe9ef2b29eaff22eda352129bba1b32`; upstream mapping input P is `bfb185b60bfe241b713fde536ddf87cbf4bb1ffc`. Waitron reads used read-only `git show <full-pin>:<path>`; none of these inspection pins is an accepted executable consumer.

At P, A means `docs/superpowers/specs/2026-10-23-a951-appliance-v1-proposal.md`, §§1–9 through END plus literal-byte verification. Publication SHA-256 `f97dbc1864e37911ecb9d16dd87b436d729fd43bbef220633c3b09cae7c93fb0`; normative digest `fede39bb64077167f145c942cc63599526ab48fae0274e4cc0b8a4e6efcca728`. Incorporate exact A schemas, closed errors, canonical bytes and every numeric bound intact, together with mapping §2; summaries here do not replace them.

At P, H means `docs/superpowers/specs/2026-10-23-a951-local-helper-v1-proposal.md`, digest `da433f66a7dcb835e99eeb4a7e5c6f01f2bc9c69db369c44a5131247a4ab008f`; X means `docs/superpowers/specs/2026-11-02-a951-host-custody-amendment.md`, digest `50001abafc7c3edea270821e0a8570f8c722969d62132070a46d9cd3729956d2`. H has isolated T3 acceptance only; X needs its Debian successor and qualification.

E's W plan `docs/superpowers/plans/2026-10-22-a951-connection.md` and intake `docs/developers/cloud-connection.md` now match D136, recorded 5 November at 11:58 per watcher: `waitron-a951-routing-v1` / `proposal-2026-10-23.2`, SHA-256 `974c4e98eb7d583d82ad1c573f9dcec01c63b2cc4f6630d38aeda22775d198d0`, solely isolated T4 synthetic contexts/policy. Both executable consumers and qualified pair remain NONE. This dated fact supersedes pending-routing wording without rewriting immutable history or the manifest.

E's 5 November engineering handoff accepts the following responsibility split only; protocols remain unaccepted. G owns Cloud establish/recover/reconnect permission consumption, authenticated receiver/one-use ledger, installation/venue/machine/node/endpoint mappings, authenticated origin/environment/root policy and fixed peer configuration, separate offline root and online response/grant/recovery issuers, and joint G3/G4 returns. E owns live `system.manage` decisions/producer/local one-use state, actual local binding/root-owned anchor, provisioning/public trust/local keys, renew/install/reload, supervisor/helper/verifier, four protected stores and GUARD16. No Cloud private issuer or gateway key goes to the box.

Source-level limits to preserve:

- `packages/registration/src/installation-proof.ts`: `MachineAction`/`readMachineClaims` include no appliance action; machine and lease verification are separate. Do not widen this list before accepted artifacts and executable tests exist.
- `packages/registration/src/installations.ts`: `execute` handles renew/configuration/report/revoke; `revokeWithSession` checks current session and exact installation's organisation owner under locks. This is an existing revoke seat, not an AP approval adapter.
- `packages/identity/src/sessions.ts:83` resolves sessions with account/session locks and checks database time after waiting. New consumption must retain current permission checks, not reuse a historical account ID.
- `packages/registration/src/index.ts:156` records registration local receipt IDs; existing registration has no authenticated A951 local actor proof. Migration 001 binds venue/local UUID/environment and installation key, not actual node/endpoint/anchor.
- `packages/account-http/src/installations.ts`, `staff-certificates.ts`, `app.ts` keep machine and browser-session routes separate; `request.ts` parses JSON and cannot alone prove duplicate-aware A canonical input.
- `packages/remote-access/src/staff-exchange.ts`, `renewal.ts` keep one current CSR row, predecessor CAS, pending/ready, test-only scope and installation revision. `manifest.ts`, `config.ts`, `public-gate.ts:103` use the older gateway audience/address model and staff upstream hostname; none is the new appliance or independent G4 protocol.
- At W, `apps/server/src/cloud-api.ts:45` checks management session/`system.manage`; its `isPrimary` is a boolean. `cloud-installation.ts` has only renew/configuration/report/revoke; `cloud-client.ts` owns serialized installation state.
- At W, `packages/node-db/src/mode.ts:19` defaults an absent row to primary/primary; `apps/server/src/promoted-role.ts` repairs role from a verified self-signed membership chart, and `singleton-pass.ts` gates fiscal work per pass. These are real A947 consumers, not a current/fresh/withdrawable G2 result. `handover-gate.ts` is request draining, not that result either.
- `packages/registration/src/migrate.ts` currently manifests 001–048 and rejects altered applied digests. `transaction.ts` owns BEGIN/COMMIT/ROLLBACK; extend through new migrations only. Existing tests use separate pools and isolated schemas.

## Review focus

1. An authentic local AP claim lacks a current Cloud owner session, or either actor loses permission while waiting: consumption refuses without a signed authorization (Permit slice).
2. Two workers consume one Permit while stop/revocation wins: one durable result or refusal, no later reopening (Permit and HTTP slices).
3. Reply loss and cache eviction turn unknown into absent or mint another grant: exact replay and permanent floors prevent it (ledger slice).
4. A higher grant changes staff intent, or recovery drops history/stops: retain independent counters, exact CSR and complete evidence (codec, recovery and staff slices).
5. Fixture identity, signer configuration or a passing mock is treated as host proof: live construction refuses and G7 stays unqualified (policy, HTTP and joint-proof slices).

## Execution rules for later build slices

Every build slice can land independently with CLOSED production construction. Dependencies below are engineering gates, not authorization to start the next slice. Re-read current bases/reservations when the watcher selects it; keep routine implementation inline.

You may build and test an unmounted candidate to obtain its full implementation pin. Recording both candidate pins and their accepted scope precedes connecting them; this avoids treating an inspection pin as the missing implementation. Genuine custody and host qualification remain separate after code exists.

Respect existing dependency direction: registration owns storage/permission argument and result types in its new ledger/Permit files; it must not import remote-access, which already depends on registration. Remote-access owns the sole appliance wire types/codec and signing. Account-http composes them using verified bytes and storage projections, without a second competing wire schema.

For each named behavioral test, write it first, run the listed command and retain its intended failing assertion before minimal implementation; import/compiler failures are not the intended red result. Rerun for a nonzero passing test count, remove each named guard in an isolated candidate and observe the unchanged assertion fail, then restore and rerun the valid positive. Preserve existing behavioral assertions and record full candidate pins, command/status and output digest.

Pure commands below run at the Cloud root. `scripts/test-postgres.mjs` commands run **only on the released shared test box or CI**, never Mac Docker; they create owned PostgreSQL/Mailpit fixtures and must not send customer mail. No database or host command runs during this publication. Each completed future slice uses signed-off commits and normal hooks; its driver runs the applicable finish/review/CI path, with no deployment implied.

Keep these cross-slice invariants explicit in every return:

- Configuration revision, content revision and grant sequence never substitute for request/report/trust/epoch floors or local generation, caller sequences, observation/custody progress and S/W.
- Exact saved signed bytes retain original deadlines. An expired replay cannot be refreshed by re-signing; use only A's explicit latest-fetch/status or newly authorized recovery correlation.
- E's shared admission heads omit only callerFloors/observationSequence/custodySequence. Local progress merges without pre-consuming an H request; a stop changes the shared head and invalidates old completion.
- Each of four protected safety copies fits 65,536 bytes with complete history. One aggregate journal is 262,144 bytes, including its 16,384 emergency reserve; ordinary peak is at most 245,760. Neither cache count nor a checksum permits evidence loss.
- No remote proof changes local fiscal clocks, writer roles, migration expectations, archive authority or ordinary local CA recovery. E retains export/import exclusion of endpoint secrets and existing restore assertions.

### Slice: publish this prerequisite plan (documentation only)

**Files:** Create `docs/superpowers/plans/2026-11-05-a951-cloud-tunnel.md`; update only the owning D560/D582 passage in `docs/backlog.md`. **Interface:** executable task boundaries and explicit unfilled returns; no runtime consumer.

- [ ] Read the required sources and self-review this plan against the full mapping, closed target and E's latest intake.
- [ ] Check links, source pins, immutable mapping hash and exact preservation of unrelated backlog bytes. Run `node --test scripts/ci-docs.test.mjs` and the immutable documentation audit.
- [ ] Obtain a fresh-context plan review, address findings, and publish through signed-off commits, normal hooks, exact-head CI and the authorised finish/landing process. Keep review receipts and campaign state outside the repository.

### Slice: close the bilateral engineering return (documentation only)

**Files:** Proposed new `docs/superpowers/specs/2026-11-05-a951-cloud-consumer-return.md`; later dated additions to `docs/waitron-integration-contract.md` only. E publishes its own successor/intake; G never edits Waitron.
**Interface:** an accepted contract/source/corpus return, not an invented approval transport. Full revised appliance, authenticated AP-channel/source pair and complete corpus are genuine prerequisites to affected adapters.

- [ ] Return one explicit row per establish/recover/reconnect: local producer full pin/path/function, actor/session/`system.manage` check and venue/node scope; Cloud receiver full pin/path/function, independent current owner-session check, and exact permission/stop/revocation recheck at consumption.
- [ ] Specify the accepted channel's authentication, correlation, delivery/expiry/revocation semantics, local one-use producer seat and Cloud durable receiver seat. Resolve how Cloud obtains **current** E permission evidence at use without holding a DB lock across a network call; pin the validity/interlock semantics bilaterally. An installation signature or `localApprovalRef` authenticates neither human authority nor current permission.
- [ ] Return exact existing A anchor/Permit/Q/result bytes and references: kind, B, expected/result epoch and ordinal, generation, nonce, operation UUID/request sequence, F/S/W, next S, issued/expiry ≤300,000 ms, authenticated proof digest and artifact/source pins. Define Cloud owner-session correlation outside the machine wire; no browser cookies/bearer tokens on appliance POSTs and no new endpoint/UI chosen by this mapping.
- [ ] Return REG/POL/PEER/KEY rows naming actual binding/provisioning consumer functions, origin/environment/root/peer provenance, custody and rotation seats, failure/revocation checks and complete source pins. Return PP protected realization and GUARD16 to E, not a Cloud substitute.
- [ ] Agree G2's actual function/full pin and result fields: target, stable identity-scope reference, current/unknown/refused, source floor, boot/freshness deadline and withdrawal evidence. Explain its relationship to endpoint B.target and A1018/D88; no membership/role/probe substitute or invented timed authority.
- [ ] Return G3 client response-byte/deadline, polling min/cap/jitter, Retry-After bounds, pending/reconciliation deadline, renewal margin/jitter and key rotation with exact numbers agreed by E/G. Return G4 as independently blocked with issuer/purpose, identities, trust/mTLS, rotation/revocation and exchange dependencies; choose no G4 defaults for this target.
- [ ] Require a shared complete signed corpus with test-only purpose-separated keys, full lease/machine/Q/response/nested grant/root Trust/Permit/result/Report/status bytes, signatures, digests and expected errors. Preserve A §9 literals and C0/Q0 hashes; M0's empty lease and templates remain deliberate non-authentic fixtures.
- [ ] Record artifact identity/edition/full digest, both acceptance scopes and both resulting full consumer pins when available; leave NONE explicitly until built. Require both codecs to consume identical complete bytes before connection. Missing contract/corpus blocks affected work; concrete conflicts go to watcher, routine engineering returns go to E/G.

### Slice: canonical appliance codec and immutable corpus, isolated

**Files:** Create `packages/remote-access/src/appliance-codec.ts`, `packages/remote-access/src/appliance-types.ts`; tests `packages/remote-access/test/appliance-codec.test.ts`, `packages/remote-access/test/appliance-corpus.test.ts`; fixture `packages/remote-access/test/fixtures/appliance-signed-corpus.json`.
**Interfaces:** Proposed `decodeApplianceRequest(bytes: Uint8Array): ApplianceRequest`, `encodeApplianceResult(result: ApplianceResult): Uint8Array`, `certificateBindingDigest(content: ApplianceContent, purpose: AppliancePurpose): string`; types derive exactly from accepted A, with distinct counter brands. No HTTP registration or issuer custody.

- [ ] Gate on accepted complete appliance successor and corpus for this codec's scope; explicitly injected foundation tests may precede acceptance but cannot be connected or labelled accepted interoperability.
- [ ] Write `canonical_mutations_refuse_without_state_writes`, `all_signed_domains_match_shared_bytes`, `independent_counters_and_staff_projection`; assert every A §9 oracle, signatures/purpose, exact errors and byte hashes, not snapshots generated by the implementation.
- [ ] Run `node --test packages/remote-access/test/appliance-codec.test.ts packages/remote-access/test/appliance-corpus.test.ts`; observe the intended canonical/binding/counter refusal failure.
- [ ] Implement only duplicate-aware bounded parsing, exact ordered J/domains and accepted type/error validation. Preserve N/U through 9007199254740991, UUID/H/D/I, no alternate escapes/number spelling, all enclosing byte/code-unit/depth/member/array caps from A §§1–6.
- [ ] Assert real installation revision 0 refuses a candidate, rev7 changed content conflicts, rev8 identical content refuses, grant11 changed bytes conflicts, grant12 same C preserves projection/CSR intent. Exercise outer escaping, exact boundary and one-over sizes; no limit enlargement.
- [ ] Rerun both suites; delete canonical, purpose, equal-revision/digest and separate-counter checks independently, require the corresponding failures, then restore. Existing `installation-proof.ts` allowlist stays unchanged in this slice.

### Slice: authenticated binding, public policy and issuer separation, CLOSED

**Files:** Create `packages/remote-access/src/appliance-policy.ts`, `packages/remote-access/src/appliance-signing.ts`; tests `packages/remote-access/test/appliance-policy.test.ts`, `packages/remote-access/test/appliance-signing.test.ts`. Consume actual `packages/registration/src/index.ts`, `packages/registration/src/installations.ts`, `packages/registration/src/installation-proof.ts`; do not replace their formats.
**Interfaces:** Proposed `resolveAppliancePolicy(input: AuthenticatedProvisioningInput): AppliancePolicy`; `createApplianceSigners(custody: ApplianceIssuerCustody): ApplianceSigners`. Internal inputs must resolve accepted source proofs; fixture constructor is separate. No new environment-variable scheme is selected here.

- [ ] Write `registration_is_not_node_or_owner_proof`, `fixed_binding_changes_refuse`, `issuer_purposes_and_root_cannot_substitute`; legitimate authenticated test mappings pass, caller labels and absent custody refuse.
- [ ] Run `node --test packages/remote-access/test/appliance-policy.test.ts packages/remote-access/test/appliance-signing.test.ts`; observe wrong binding or cross-purpose signer being accepted.
- [ ] Implement accepted installation/venue/key/environment joins, authenticated actual local venue/node/endpoint provenance, reversible UUID-node conversion and SPKI digest. Preserve actual localVenue spelling when it satisfies A.I; a UUID already fits that grammar. Strip hyphens only for the specified node conversion, not other identities; unfamiliar forms refuse pending an accepted mapping.
- [ ] Bind exact HTTPS origin/root and peer policy to B/cell/gateway/endpoint/addresses/local public key; reject unknown references, fixture input in live construction and all topology changes. Keep offline root, response/grant/recovery, lease/machine/TLS/CA/WireGuard keys distinct.
- [ ] Sign exact decoded payload bytes through the agreed custody interface; ordinary responses use response keys, Permit results recovery keys, grants grant keys, Trust offline root. Root private key is not an online service dependency; box receives public provisioning only.
- [ ] Test lifetime/overlap/expiry and wrong-purpose boundaries, missing issuer/root provenance, and signer output against complete corpus. Rerun/delete/restore binding, provenance and purpose guards. A signing/configuration module with injected keys is not genuine custody or qualification.

### Slice: durable request, grant, latest-fetch and report ledger

**Files:** Create `packages/registration/src/appliance-ledger.ts`, `packages/registration/test/appliance-ledger.test.ts`, `packages/registration/test/appliance-ledger-races.test.ts`, `packages/registration/test/appliance-migration.test.ts`; append `packages/registration/src/migrate.ts` and a new migration.
**Migration path:** Proposed `packages/registration/migrations/049_a951_exchange.sql` assumes current 048; regenerate the actual next free number/name at execution. Never edit 001/009/030/046/048 or another landed file.
**Interfaces:** Proposed `ApplianceLedger.transactRequest(input: AuthenticatedApplianceRequest): Promise<StoredApplianceResult>` and `reportStatus(input: AuthenticatedReportQuery): Promise<ApplianceReportStatus>`; exact returned result/envelope bytes, permanent floors and latest slot survive worker restart.

- [ ] Write `same_request_two_workers_one_saved_result`, `eviction_keeps_request_report_floors`, `latest_fetch_survives_expiry_restart`, `lost_report_reply_status_unknown_not_absent`; retain exact action/UUID/Q/body/report bytes and digests in assertions.
- [ ] Run `node scripts/test-postgres.mjs exec node --test --test-timeout=120000 packages/registration/test/appliance-ledger.test.ts packages/registration/test/appliance-ledger-races.test.ts packages/registration/test/appliance-migration.test.ts`; observe duplicate mint, floor rollback or incorrect absent result first.
- [ ] Add new exact-byte storage and constraints, lifecycle floors, eight complete request results/eight report results, one pending report and independent latest-fetch slot. JSONB alone cannot retain signed bytes; store bytes separately. No unbounded UUID replay promise; never evict the latest slot or permanent floors.
- [ ] Persist accepted authenticated binding/provisioning references beside the installation ledger, including local node/endpoint and origin/root/peer policy provenance. A legacy venue/key row cannot populate those absent proofs automatically; migration adds no established baseline or admission backfill.
- [ ] Use `transaction.ts`, installation row serialization and explicit bounded ledger locks. Persist issuance/request/result atomically before reply; installation/content/grant counters, request/report/trust/epoch and S/W remain separate. Refuse overflow, equal revision/different digest and changed bytes at one identity.
- [ ] Implement exact FetchRef replacement only by a higher fetch naming the durable latest predecessor, preserving floors and issuing a strictly higher grant. It cannot supersede Report/Permit work; expired slot loss requires recovery, not null. Identical retry returns original saved bytes/expiry, never re-signs to extend authority.
- [ ] Record exact Report before recorded reply. Retained exact report retry can reconcile after request eviction; fresh signed status is correlated to its own Q. Absent requires sequence above report floor and no pending/committed match under lock; evicted older is unknown and remains unresolved.
- [ ] Race two independent pools with barriers and real PostgreSQL lock waits, restart between commit/reply, fetch predecessor replacement, report/status ordering and rollback before commit. Test additive migration/restart/applied-digest refusal. Rerun/delete/restore correlation, floor and latest-slot guards on the shared box/CI.

### Slice: two-actor AP permissions and durable one-use Permit/result

**Files:** Create `packages/registration/src/appliance-permits.ts`, `packages/registration/src/appliance-permissions.ts`; tests `packages/registration/test/appliance-permits.test.ts`, `packages/registration/test/appliance-permission-races.test.ts`; extend the ledger and append a new migration/manifest entry.
**Migration path:** Proposed `packages/registration/migrations/050_a951_permits.sql`, provisional only; regenerate at execution after earlier landings.
**Interfaces:** Proposed `consumeAppliancePermit(input: AuthenticatedPermitConsumption): Promise<StoredApplianceResult>`; input resolves accepted authenticated AP producer evidence and independent live Cloud owner-session correlation, never a bare account ID or self-signed local approval.

Proposed `createAppliancePermit(input: AuthenticatedPermitDecision): Promise<StoredPermit>` records A's unchanged Permit before consumption. The accepted channel supplies both live decisions and their correlations; neither method creates a new approval UI or exports Cloud session secrets to E.

- [ ] Gate on bilaterally accepted exact AP channel and source pair. Write `local_proof_cannot_create_cloud_owner`, `cloud_owner_cannot_create_local_manage`, `two_consumers_one_result`, `stop_or_revocation_invalidates_waiting_consumption`; missing adapters remain closed dependencies.
- [ ] Run `node scripts/test-postgres.mjs exec node --test --test-timeout=120000 packages/registration/test/appliance-permits.test.ts packages/registration/test/appliance-permission-races.test.ts`; observe invalid authority consumption or a second result first.
- [ ] Implement accepted receiver validation, proof retention and one-use Permit/result transaction. Check exact kind/B/nonce/operation/sequence/generation/expected epoch/F/S/W/next S/expiry and accepted artifacts. Independently resolve live Cloud session/CSRF in its accepted owner channel and exact installation's `is_owner` membership at use.
- [ ] Reconcile E's authenticated current actor/permission evidence with Cloud's separate current owner authority; neither machine proof nor stored approval snapshot suffices. Recheck after waits using database time. Durably consume the decision and retain exact result R/digest, immutable signing metadata and permission/revocation evidence before signing success; persist its exact signed envelope before first reply.
- [ ] Establish only with authenticated root-owned anchor and never-established Cloud ledger; recover only under separate damaged-state authorization; reconnect only same nonrevoked machine/endpoint with exact expected S/W and targeted S+1. E consumes its own local one-use result and four-store commit; Cloud cannot clear E's latches itself.
- [ ] Trace lock consumers before choosing order: `resolveSession`, `revokeAccountSession`, `revokeWithSession`, machine revoke, owner membership changes and ledger issuance. Use their compatible account/session/permission/installation order; no permission transaction may wait on E/network/helper work.
- [ ] Test blocked-session expiry, logout/session revocation, owner removal, installation revoke and concurrent stop/withdrawal both before lock acquisition and before commit; assert rollback leaves no consumed success. If consume commits first, the later stop/revoke still fences use; cached success never authorizes reopening.
- [ ] Test consumed/changed/expired Permit, wrong actor/venue/purpose, absent producer, stale nonce and duplicate delivery across pools/restart. Rerun/delete/restore each permission, one-use and stop/revocation fence; preserve existing session/installations behavioral tests.
- [ ] Crash after consumption and before signed-envelope persistence: resume only the saved decision/metadata, never create another authorization or later expiry. Retained retries return the same envelope; expired/unverifiable results require A's fresh authorized correlation, not silent renewal.

### Slice: restrictive trust history and HIGH WATER recovery

**Files:** Create `packages/remote-access/src/appliance-recovery.ts`, `packages/remote-access/test/appliance-recovery.test.ts`; add `packages/registration/test/appliance-recovery-ledger.test.ts`; extend ledger/Permit code only for accepted recovery rules.
**Interface:** Proposed `mergeApplianceRecovery(evidence: AuthenticatedRecoveryEvidence): RecoveryDecision`; consumes complete independently authenticated histories/maxima, not arbitrary supplied F or replacement history from a recovery signature.

- [ ] Write `all_evidence_loss_stays_recovery_required`, `surviving_history_union_keeps_tombstones`, `new_epoch_never_clears_stops`, `intact_reboot_is_not_recover`; retain valid surviving-evidence recovery positive.
- [ ] Run `node --test packages/remote-access/test/appliance-recovery.test.ts` and, on box/CI, `node scripts/test-postgres.mjs exec node --test --test-timeout=120000 packages/registration/test/appliance-recovery-ledger.test.ts`; observe lost stop/history or incorrectly bootstrapped identity first.
- [ ] Implement A §§3/8 restrictive union: minimum firstSeen, maximum lastSeen/through revision, revoked > retired > active, immutable purpose; refuse missing higher complete history, equal revision disagreement and 257th lifetime key. Keep all 256 entries, no tombstone eviction or unbounded sidecar.
- [ ] Merge authenticated floors without resetting grant/request/report/local-generation/S/W; recover names a higher ordinal/new opaque epoch only, changed B content needs higher revision, equal ordinal/different epoch conflicts. Result binds locally verified history digest and returns closed with recovery hold as required.
- [ ] Preserve mapping's each-65,536-byte safety/one-262,144-byte journal limits and inside-16,384 reserve; E owns four-store serializer/PP/Shared(State) proof. Cloud receipt cannot replace those proofs, reconstruct unreported stops, supply trust or authorize missing-file bootstrap.
- [ ] Test full ledger loss/unavailable storage, partial independent evidence, exact recovery retries/expired saved result and reconnect races. Rerun/delete/restore complete-history, maxima and latch guards; ordinary local CA/data recovery remains independent.

### Slice: dedicated bounded appliance HTTP adapter, default CLOSED

**Files:** Create `packages/account-http/src/appliances.ts`, `packages/account-http/src/appliance-request.ts`; tests `packages/account-http/test/appliances.test.ts`, `packages/account-http/test/appliance-http-races.test.ts`; modify `packages/account-http/src/app.ts`, `packages/registration/src/installation-proof.ts` and package exports only after gates below.
**Interfaces:** Proposed `applianceResponse(c: Context, options: ApplianceHttpOptions): Promise<Response>` consumes accepted codec/policy/signers/ledger/AP seats. Proposed raw bounded reader preserves duplicate-aware parsing; do not weaken existing `request.ts` or staff routes.

- [ ] Require full appliance acceptance, shared corpus passing both codecs and both full consumer pins/accepted scope recorded before connecting adapters. If absent, leave adapter unmounted and machine allowlist unchanged; no synthetic proof reaches production construction.
- [ ] Write `closed_dependencies_refuse_all_appliance_paths`, `machine_proof_is_not_human_permission`, `appliance_headers_sizes_and_rates`, `invalid_proofs_consume_shared_ip_budget`, `revocation_between_authenticate_and_execute`; valid complete fixture exchange must also pass.
- [ ] Run `node scripts/test-postgres.mjs exec node --test --test-timeout=120000 packages/account-http/test/appliances.test.ts packages/account-http/test/appliance-http-races.test.ts packages/account-http/test/installations.test.ts packages/account-http/test/staff-certificates.test.ts packages/registration/test/installation-proof.test.ts`; observe an unauthorized or stale request succeeding first.
- [ ] Mount only A's seven exact POST suffixes under `/api/installations/`; extend both MachineAction type and runtime allowlist together only now. Do not send appliance actions to `InstallationStore.execute`, staff exchange or old gateway verifier. Strict configured HTTPS origin; no query, browser Origin, cookie, bearer, redirect or compression.
- [ ] Consume the shared `installation-ip` 60/IP/min budget before bounded body reading or proof authentication. Authenticate stored key/current lease and revocation, then consume the shared `installation-key` 30/authenticated-installation/min budget. Assert invalid appliance proofs exhaust the same IP budget as existing machine requests; neither a new route nor a failed signature bypasses it. Repeat authority checks in the execution transaction. Preserve 5,000 ms request-read and all A enclosing limits; serialize bounded signed responses, retaining actual 400/401/403/408/409/413/415/429/503 causes.
- [ ] Assert default construction with absent genuine AP/G2/root/custody returns closed refusal and zero issuance; no live fixture constructor. Malformed duplicate input cannot become canonical through JSON.parse. Exercise delayed body, response correlation, lost reply and revoke/stop races through HTTP and independent pools.
- [ ] Rerun/delete/restore route/action, canonical-reader, current-permission, replay and dependency guards; preserve existing proof/installations/staff assertions. No service/CLI configuration is enabled by landing this slice.

### Slice: preserve staff-v1 and return the exact G3 test-client contract

**Files:** Add `packages/remote-access/test/appliance-staff-compatibility.test.ts`; extend existing `staff-reconciler.test.ts`, `packages/account-http/test/staff-certificates.test.ts` only where new assertions are needed. Record joint G3 return in the proposed consumer-return document and a dated contract addition.
**Interface:** Existing `StaffCertificateExchange` submit/status and `publishStaffCertificate` remain separate; E's T7/T8 consume the agreed G3 policy, durable CSR/submit/predecessor and projection. No new staff purpose/action/state or invented historical ID ledger.

- [ ] Require exact G3 numeric client policy from the first return before E's adapter; Cloud issuer retry schedule and renewal eligibility are not client polling defaults. Keep independent G4 return blocked.
- [ ] Write `higher_grant_and_trust_rotation_preserve_pending_staff`, `installation_revision_invalidates_intent`, `production_or_public_purpose_refuses`, `stop_fences_appliance_authorization_despite_ready_staff`. Cloud tests prove publication/response boundaries; return E's separate `stop_blocks_late_ready_install` assertion for actual select/install/reload.
- [ ] Run `node scripts/test-postgres.mjs exec node --test --test-timeout=120000 packages/remote-access/test/appliance-staff-compatibility.test.ts packages/remote-access/test/staff-reconciler.test.ts packages/account-http/test/staff-certificates.test.ts`; observe intent replacement or widened staff authority first.
- [ ] Make only the minimal compatibility correction demonstrated by a failing assertion, if any. Preserve submit/status bytes, installation `revision`, opt-in/test/configured issuer, CSR signature/exact CN/SAN/RSA≥2048, 4,096-code-unit body/CSR and 16,384-byte chain limits, pending/ready and current predecessor CAS.
- [ ] Verify equal C/grant11→12 preserves submit UUID ending0040, exact CSR/body/predecessor/key; installation-only change invalidates, public-only projection change preserves staff. Stop/expiry/authority loss blocks late install/reload in E, irrespective of ready Cloud response.
- [ ] Rerun/delete/restore intent, test-only and purpose guards; retain server renewal eligibility `min(30 days,lifetime/3)`. A certificate returned by Cloud proves neither install/reload nor full staff-browser qualification.

### Slice: final joint isolated fixed-box proof, selected by watcher

**Files:** Proposed `scripts/a951-fixed-box-receipt.mjs`, `scripts/verify-a951-fixed-box-receipt.mjs`, `scripts/verify-a951-fixed-box-receipt.test.mjs`; dated receipt references in Cloud contract only. E owns its existing proposed `bench/a951-connection/run.mjs`, connection suites and host/intake changes.
**Interface:** Proposed public receipt binds artifact/corpus digests, both full executable commits/builds, accepted path scope, actual Debian pinset, commands/status/output digests, raw samples/maxima/uncertainty and independent network/listener outcomes. Never include secrets/customer data or invent a runtime approval token.

- [ ] Prerequisites: accepted full appliance/channel/source pair/corpus; actual G2 mapping; exact G3; scoped G6 processing/access/destination/retention including staff metadata; E's Debian successor, protected PP/GUARD16 and public-policy/key provisioning; applicable issuer/DNS/device/origin evidence. Missing fields visibly fail, never skip to green. Provider/device operations need their separately authorized owner, not this plan.
- [ ] Write `receipt_rejects_missing_pins_scope_or_guard_controls`; run `node --test scripts/verify-a951-fixed-box-receipt.test.mjs` red, implement minimal verifier, rerun green. `node scripts/a951-fixed-box-receipt.mjs --help` must describe the accepted fixture input; runner invocation waits for the exact accepted rig and released box.
- [ ] Require real Debian 13 valid staff/probe positive, wrong caller/binding/port/family negatives, each guard removed independently with the other boundary permissive, and restored positive. E retains X §9 full custody/borrowed-FD/stop/crash/freeze/suspend/reboot/resource collision matrix and H exact tuples; no Mac Docker or Ubuntu inventory substitutes.
- [ ] Measure both guards, listener absence and every accepted socket copy separately ≤1,000 ms; both directions/established/resumed packets, immutable deadlines, full-budget priority stop and 16-object inventory must pass. Failed sleep/closure bound rejects that host or returns an explicit successor conflict, never a relaxed claim.
- [ ] Exercise real saved replay/status/latest-fetch, Permit double-consumption and stop/revocation races across the pair; initial H caller mutation advances its own floor once while preserving committed shared head, then a shared stop invalidates it. No lock waits on network/participant/helper; partial four-store commit never admits.
- [ ] Run `node scripts/verify-a951-fixed-box-receipt.mjs <retained-receipt.json>` against the exact receipt. The argument is an accepted local receipt path, not a network destination; verifier exits nonzero on a missing prerequisite, sample, signoff or pin mismatch.
- [ ] Rerun changed boundaries after any pin change. E signs host/build inventory, G signs consumer/mapping scope, host reviewer signs evidence under accepted release-approval policy; absent signoffs fail.
- [ ] Record only qualified isolated test paths. Production admission stays CLOSED, G4/G5 disabled, empty manifest unchanged and `.local` independent. Driver handles finish/CI and watcher selection of any later work; no production/provider permission follows.

## Self-review and remaining real decisions

This plan maps A §§1–6 to codec/policy/HTTP, A §7 to ledger, A §§3/8 to Permit/recovery, A §5/G3 to staff, and mapping §§3–9/H/X to E's protected consumers and joint proof. All review-focus rows have named failing tests; no implementation body, test execution or qualification is supplied here.

**Assumptions:** proposed module boundaries fit existing package ownership; provisional migration numbers will change; internal types will be derived from the accepted successor rather than becoming a parallel protocol. These assumptions confer no trust or authority.

**Real returns still required:** authenticated AP channel/current dual-permission interlock and source pair, actual registration-to-node/endpoint proof, issuer custody/provisioning, complete appliance successor and shared signed corpus, actual A947 G2 semantics, exact G3 client policy, scoped G6 processing and Debian G7 runtime pins/measurements. G4 and G5 remain separate future gates. Escalate only concrete security/product conflicts through watcher; do not reopen routine build approval.
