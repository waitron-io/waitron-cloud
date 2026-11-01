# Replay allocation compatibility

Cloud's replay runtime still pins Waitron
`fbadd15785464e59747e697c11048bfbc6e4938f`, whose restore reader requires retired
node and location settings. D451/PR700 writes only `WAITRON_NODE_ID`. You need a
matching release and its real allocation callers before you can qualify that repair.

## Authority and status

The owner's answer in Lane D `questions.md`, 2026-11-01 around 11:10, authorizes
option 1: adapt Cloud to Waitron's existing installation allocation exactly as
Waitron's own callers do. It forbids arbitrary installation numbers, fallbacks,
bypasses, and golden or restore assertion changes. This is compatibility work,
not permission to change fiscal policy. [Documentation ownership](../../documentation-ownership.md)
keeps allocation and restore implementation in Waitron; Cloud owns its caller.

This is the separate high-effort design required by RUNNER section 0. The returning
driver must check it, obtain the section 5.2 fresh-context read, and land the two
documents as a docs-only milestone before implementation. Routine execution stays
inline. **A protected-check conflict below prevents implementing the complete
proposal under the present answer.** Landing this document does not resolve it.

## Evidence and its limits

The author inspected Cloud main `80b994e481de3d6fc1b6a0641437aa2ebeb110d4`, the
two-commit PR700 tree through `git diff 1fc9003b~2 1fc9003b`, and the literal
Waitron release through `git -C /Users/clintongormley/workspace/repos/waitron show
b1b0f109:<path>`. Every Waitron path below means
`b1b0f10952a59eb59f7358bd681a3cdc94d9b61c`, not moving main.

Lane receipts at `~/waitron-campaign-d/receipts/d451/resume-20261101/`
contain `checkpoint.json`, `candidate.patch`, `probe.mjs`, and raw qualification
logs. They record three original replay checks failing before assertions, first
on missing `runtime/assets/invoice-noto-sans.ttf`, then on
`sif.allocation_invalid` / `installation_invalid` after copying the actual pinned
asset. The patch's diagnostic exception logging is not a proposed product change.
The earlier `receipts/d451/triage.md` retains the 585-second review and explicitly
limits its runtime and container claims. Its old merge hold is superseded by the
landed release and the owner's answer; its failed evidence remains unchanged.

The separate author ran source inspections and the font digest command only.
The driver then bundled and ran the actual `assertHourSeriesConfiguration` guard:
two purposes throw `sif.allocation_invalid` / `series_configuration_unsupported`,
while standard, full and rectificative pass. Its source bytes match this literal
release (SHA256 `5c830bc8a93a283ba1108e0d0b760ae0c75e979e57fc3b6799891e14fe50cfb2`).
The command used esbuild on `src/hour-series-configuration.ts`, then Node assertions
against the resulting module. This narrow native experiment proves that guard,
not replay, restore, Docker or interoperability. The caller design is unexecuted.

## The protected-check conflict

| Inspected contract | Consequence for Cloud |
| --- | --- |
| Waitron `software.ts:1` fixes `WAITRON_ID_SISTEMA = "W1"`; `hour-throwaway-allocation.ts` generates the minute identity and `${base}-${identity}` series. | Cloud's `WR` fixture input cannot select software identity. Bare `R` and `F` are bases, not allocated codes. |
| `packages/provisioning/src/venue-plan.ts` requires `rectificativeSeriesCode` and plans standard, full and rectificative series. `hour-recovery-state.ts:61–63` calls `assertHourSeriesConfiguration`; `hour-series-configuration.ts:4–13` requires exactly those three purposes. | The normal provision-and-restore caller needs three series. A two-series throwaway setup does not establish a supported recovery path. |
| Cloud `fixtures/replay-conformance.test.mjs:136–138` requires two SIF rows, exactly two active series and exactly two retired series after restore. | Normal three-purpose setup would require three active and three retired series. Changing those two expected counts is an explicitly forbidden restore assertion change. |
| The same file selects `code='R'` at lines 49, 93 and 105; private and cadence checks also select bare `R`. | Keeping their numeric assertions requires selecting the actual allocated standard series. Silently rewriting the selector is still a changed check and needs to be inventoried. |

The native guard result confirms the two-purpose mismatch. The normal recovery
caller cannot qualify those exact two-series expectations through this guard.
Do not add dummy bare series, hide the third purpose, filter counts, keep a legacy
SIF, or bypass the recovery reader.

The driver must report the exact conflict to the owner. A narrowly scoped possible
amendment would allow `W1`, three fixture purposes, exact allocated-series
selectors, the source-bills fixture's exact fresh rows changing from two bare
codes to three allocated codes, and the two restore series counts changing from
2 to 3. The replaced-destination control would use a genuine owned capture instead
of empty bytes so it still reaches and checks destination ownership. Retain every
numeric sale, invoice-number, hash, rollback, two-SIF/new-installation, private-state
and cleanup assertion, including all replacement/sentinel checks. This complete
fixture/check amendment is **not approved by this spec**. Alternatively the owner
must choose a different scope or name an upstream dependency. Until then, keep PR700 and its
published `1fc9003b99ffd7bd8680809ce310d59c8ed6e60a` head intact.

## Required caller, after the conflict is resolved

Use `provisionVenue(deps, req, availableModules)` from `apps/server/src/provision.ts`.
Set both `req.environment` and `req.initialAllocation.hostEnvironment` to
`preproduction`, with `initialAllocation.kind = 'throwaway'`. Resolve modules
through `venueModuleConfig(..., 'ES-common')`, register their permissions, and pass
a complete `VenueRequest`, including a generated administrator with real password
and PIN hashes. The address and administrator belong to the generated replay
venue; never copy customer credentials or identities into setup.

That caller stamps deployment, runs `planVenue`, obtains `throwawayApplyInput`,
and applies its returned node/admin IDs, module inputs and module operations.
`applyVenue` issues callback-scoped operation authority, prepares allocation,
and invokes `ALLOCATED_FISCAL_SEED` in its transaction. The seed activates the
prepared allocation and resolves its series. Consume returned IDs and verify
their purpose and node binding. Never insert scaffold invoice series or call
`registerSif` directly. Do not use `seedFixtureSif`, fabricate an envelope, or
substitute the test-only `testing/staged-hour-restore.ts` caller.

Keep `openReplay({codeRoot,stateRoot,config,initial})` and its sale/capture/restore
results closed to extra fields. Fiscal software identity comes from Waitron;
reject a conflicting input rather than silently ignoring `WR`. Any initial-shape
amendment belongs in the changed-check inventory. Continue writing exactly
`WAITRON_NODE_ID=<generated node>\n` to a new 0600 file in the private 0700 root.

For recovery, mint a real node recovery key with `mintBreakGlassKey(db,nodeId)`
before capture; retain its secret only in private memory. It is distinct from the
archive encryption key. Restore only an archive captured from this generated
replay instance. Bind its byte digest, validated source ID and node to a private
capture record; reject an unrelated archive, even if decryptable. A copied customer
database is read-only input for bill extraction, never an activation target.

Before recovery preparation, drain admitted source operations and close the source
writer. Permanently refuse later source sales and captures, retain the source
database bytes for read-only comparison, and serialize recovery. Keep the generated
private identity files needed by existing equality assertions.
With those measured lifecycle facts, the fixture host can attest
`oldMachineOffline: true`, `oldMachineAbsent: false`, and `noParallelRecovery: true`. In Waitron's recovery
API the second flag describes the recovery declaration, not a filesystem probe.
`close()` must remain idempotent; a wrong-key attempt must still clean only its owned partial target and
allow the original artifact to retry. Never claim a stopped source from a constant
boolean while its writer remains usable. No source-database deletion is required for this generated fixture.

Use `validateArtifact`, `readRecoveryCopyPreview(copy,copy.sourceId,deps)` and
`readArtifactNode(copy)` to inspect a private staging copy. Create
`createSelectedRecoveryPreparation` with a real `createFirstSetupCoordinator`,
the selected preview, node recovery secret, matching private inspection database,
and `readIsolation` derived from the source lifecycle above. Bind
`{module:'fiscal-verifactu',action:'restore',eventId,sourceId:copy.sourceId,
targetNodeId:node.nodeId}`. Drive `service.prepare` through clock comparison,
preview and selection, honoring its waiting result, then pass
`service.runner(selected.input,{refresh:true})` as `restoreFromArtifact`'s
`withModuleOperations`. Close/discard inspection handles before placement. Preserve
`checkBeforePlacement`, source binding and the module hook transaction.
The preview may migrate its own disposable copy; it must never migrate or activate
the customer input database.

This is the authenticated path: `createRecoveryRestoreRunner` uses
`withRecoveryKeyOperation`, which verifies the stored key before issuing authority;
`withPreparedModuleOperations` supplies the live preparation token to
`ALLOCATED_FISCAL_RESTORE`. Deserializing an authority object, inventing an operator,
or setting `skipSecrets` cannot replace it. Recovery retains local node identity
but activates a new fiscal installation and retires the old series.

Clock observations for this generated replay are synthetic. Keep the real
provisioning, clock-decision, prepared allocation and restore code. Use the host's
explicit `testClock` seam for wall/monotonic readings and a test-only bundle adapter
around `observeInternetHourClock` that supplies its existing `deps.request` seam
with controlled responses. Preserve the real observer's date, freshness, timeout
and uncertainty checks. The adapter must never issue the default HTTPS HEAD.
`testClock` alone does not suppress that request. Cover clock challenge/browser
comparison, preview/selection and the runner's refresh with `browser=null,onBox=true`.
Missing, stale, skewed and changed clock responses must still refuse. Label this
as synthetic runtime replay, never production clock, TLS or independent-time
qualification. No outside endpoint, egress permission or owner clock decision is
needed for this fixture boundary; prove the adapter and isolation before relying
on it.

## Release and asset boundary

Use exactly `b1b0f10952a59eb59f7358bd681a3cdc94d9b61c` for new replay preparation
and runtime admission. Keep fetch, checked-out HEAD, manifest revision, runtime
digest and migrations from the same source. Browser qualification keeps its
independent `99c265981ba98f1afd0e5fc822624a9a91822ad2` pin. No moving branch,
old-pin fallback or digest bypass is allowed.

Copy `apps/server/src/assets/invoice-noto-sans.ttf` from each actual pinned source
to `assets/invoice-noto-sans.ttf` beside its bundle. The replay release's SHA256 is
`bfb7bb691513f12e734dc346c03a03f784912432d7e3fa8e56efcf906fe86b3d`, measured with
`git show b1b0f109:apps/server/src/assets/invoice-noto-sans.ttf | shasum -a 256` in
the read-only Waitron checkout. Include it in ordinary runtime, stack-runtime,
owner-peer copies and every mounted/image-contained bundle. Generated font strings
prove copy plumbing only. Do not replace the independently pinned browser font.

Trace `rg -n fbadd157 scripts packages docs` again after rebase. Current consumers
are preparation, adapter and isolated admission; source/install/browser-pin test
fixtures; wrapper manifests; isolated/owner revision readbacks; and current
`local-receipt.mjs` / `archive-storage-receipt.mjs` producers. `archive-evidence.mjs`
also serves historical validation. Keep historical validation distinct from new
production: new builders require the new literal pin; historical records retain
their literal pin and all existing structural checks. `joined-evidence.mjs` and
the projection of the old complete experiment stay historical and must reject
mixing old and new samples. Do not widen every SHA check or redesign cost evidence.

Leave all generated `docs/cost-model/*.json` evidence and historical descriptions
in `docs/backlog/cost-setup-timeout.md` and `docs/backlog/browser-reconnect.md`
unchanged. Their old revision is provenance, not stale configuration.

## Acceptance and exclusions

After any necessary owner resolution, acceptance requires observed focused
RED/GREEN runs, guard-deletion failures and restored controls in an owned installed
disposable copy, native checks, Linux test-box qualification, bounded review of the
substantive delta, the normal push hook once, and every current-head CI job final
and green. Preserve actual sales, numbering, transaction rollback, append-only
rows, hash integrity, source identity, private state and real restore effects.
The [plan](../plans/2026-11-01-replay-allocation-compatibility.md) inventories changes
and sets the finish/landing gates. Discovery and mocked preparation cannot
discharge runtime qualification.
The real generated replay must run with its explicitly synthetic clock boundary.

No Waitron edits, fiscal implementation changes, immutable-row edits, golden
changes, live provider calls, customer mail, spending, deployment or broad cost
model redesign belong to this work. The author writes only this spec and its plan;
the driver records the fresh builder check, docs landing, exact protected-check
decision and implementation validation separately.
