# Test Cloud on your home network

You need a separate Cloud account service to exercise your test server without touching its existing venue. The test deployment uses its own Compose project, database, storage and private configuration. Its canonical address is `https://waitron.local:3000`.

The deployment files and local HTTPS, storage, remote, backup-verifier and free-service fixture proofs are implemented. **The test box is not deployed yet.** Plan enforcement remains off until the final disposable Waitron integration and release checks pass. Address providers stay disabled. Translation stays off pending the pinned joint paging proof and owner trials after 2 November 2026. Outside-home remote access needs a separately approved domain, certificates and deployment.

## What is reachable

Only the HTTPS proxy publishes to `192.168.10.10:3000`. It forwards to the unpublished account listener and accepts the exact canonical Host and, when present, Origin. It replaces forwarding headers and the account server trusts only its private address, `10.79.0.2`. Ordinary loopback deployment keeps `http://localhost:3000`.

PostgreSQL uses loopback port 55432. This project's Mailpit uses loopback ports 1125 and 8125, leaving Waitron's 1025/8025 alone. Storage 8333 and gateway 8443/UDP 51820 also remain on loopback until their separate adapter proofs pass. The account backend keeps `10.79.0.3`, so replacing it preserves the proxy's destination without a proxy restart. The private Docker network is `10.79.0.0/24`; preflight refuses overlapping existing networks. All container memory limits, including dormant profiles, sum to 1,824 MiB. That limit is not a measurement of test-box headroom.

The explicit test email worker uses the existing account-mail templates and outbox. Its SMTP destination is fixed to loopback inside this project's Mailpit network namespace. The ordinary local and production mailers keep their origin restrictions.

## Check free services locally

You can check free-service eligibility without enabling a provider or deploying to the box. From a clean, committed checkout, run:

```sh
node scripts/test-postgres.mjs exec node scripts/test-cloud-free-services.mjs > /tmp/cloud-free-services.json
```

The command owns a temporary PostgreSQL and Mailpit pair and removes them afterward. It runs seven groups of checks in separate processes, one file at a time, and emits a receipt containing the Cloud commit, tree and test counts. Run without `NODE_OPTIONS`: Node filters can silently omit cases, so the proof refuses that environment override. A missing file result, failure, cancellation, skip or unexpected child output refuses the receipt. Only fixed labels and counts enter it; account addresses, message links, tokens, translation content and database credentials stay out. The validator checks the receipt's structure and completeness; keep the original run as its evidence.

Both plans receive Cloud signup and password-recovery mail. Paid status creates no venue email grant: the separate relay fixture needs explicit consent and an installation-bound challenge over HTTPS with its own trusted test CA. It captures delivery in Mailpit, then checks that revocation cancels queued mail before handoff. The translation fixture uses a fake loopback provider and checks that plan changes preserve an existing job's retry, collection and release after consent and readiness are withdrawn. Existing tests also cover false origin evidence, expired grants, ownership changes, stopped relay, missing consent, exhausted allowance, foreign jobs, invalid cursors and the complete 16,777,216-byte page bound.

These are Cloud fixture results. They leave deployed translation off, address providers disabled and normal relay startup unavailable. Waitron commit `e2ca1ca487412a2bb7ef1277e48c6adad6068c85` has a paged translation reader, but this proof does not qualify that client or satisfy the separate joint and owner gates. Its email transport still selects SMTP, local capture or unconfigured delivery; this proof supplies no Cloud relay caller. The receipt marks both Waitron journeys `not-qualified`. Final integration, image qualification and test-box deployment remain separate work.

## Check venue-level services

Use the separate venue-level proof to check that a registered venue cannot start
paid work while a connected venue can. From a clean, committed checkout, run:

```sh
node scripts/test-postgres.mjs exec node scripts/test-cloud-free-services.mjs --venue-levels > /tmp/cloud-venue-services.json
```

This version-2 receipt records nine groups: rules, installations, backups,
recovery, remote access, translation, relay, runtime and storage. It includes the
commit, tree and passing test counts, and refuses missing, failing or skipped
groups. The original command and its version-1 free/paid receipt remain available.
Neither command qualifies a Waitron client or a live provider.

The ordinary command runs one group and one file at a time. CI sets
`CLOUD_SERVICE_PROOF_CONCURRENCY=2` to run at most two groups of two files while
retaining every check and the same receipt fields. Values other than `1` or `2`
refuse the proof.

For private fixtures, select venue-level authority with
`CLOUD_VENUE_SERVICE_LEVELS=test` and `CLOUD_TEST_SERVICE_PLANS=0`. Account,
translation, backup and remote worker commands pass that choice to their service
checks. A conflicting or invalid setting refuses startup before database work.
The checked-in deployment leaves this mode dormant; production enforcement,
deployment and the upgrade/recovery qualification remain separate gates.

## Build and transfer an image

Build on your Mac using your existing package-read token as a BuildKit secret. The target box builds nothing and receives no source checkout or token. From the reviewed Cloud checkout:

```sh
docker build --platform linux/amd64 \
  --secret id=npm_token,env=NODE_AUTH_TOKEN \
  --build-arg SEAWEED_AMD64_SHA256=31fb804858885f9e7e18b6d3b1da09e824baac3e6a55b5a62c3c4c77e6ed6d7d \
  -f deploy/local-stack/Dockerfile \
  --tag waitron-cloud-test:reviewed .
```

The SeaweedFS checksum above is the amd64 value pinned in `compose.yaml`. Record the resulting **image ID**, for example `sha256:…`. The deployment driver accepts only a complete image ID and verifies `linux/amd64` before startup. A manifest-list digest or mutable tag is not an image ID.

Transfer only `compose.yaml`, `deploy/test-cloud/compose.yaml`, `deploy/test-cloud/test.env` and `scripts/test-cloud-deploy.mjs` into an isolated deployment directory with the same relative paths. The runtime, proxy and bootstrap are already inside the image. Set no build token on the box. From that directory, the driver supports:

```sh
node scripts/test-cloud-deploy.mjs preflight sha256:<64-hex-image-id>
# Stream docker save from the Mac into this command over SSH:
node scripts/test-cloud-deploy.mjs load sha256:<64-hex-image-id>
node scripts/test-cloud-deploy.mjs up sha256:<64-hex-image-id>
node scripts/test-cloud-deploy.mjs status sha256:<64-hex-image-id>
node scripts/test-cloud-deploy.mjs stop sha256:<64-hex-image-id>
```

These are the implemented operator commands, not permission to deploy before the remaining proofs. `load` reads the image stream on standard input; `up` uses `--no-build --pull never`. Preflight requires Compose 2.24.4 or later, x86-64 Docker, at least 4,096 MiB available RAM and 20 GiB free disk, unused selected ports and no unrecorded test-project containers. It rejects a changed image for an existing deployment; schema upgrades need the later coordinated private backup/restore procedure.

The driver samples resources and the three existing Waitron containers every five seconds through startup and a sixty-second settled window. An owned out-of-memory event, Waitron health regression, or three consecutive readings below 2,048 MiB available RAM or 15 GiB free disk abort startup and stop recorded Cloud containers. It leaves volumes in place. If a full host-inventory read fails during rollback, the driver checks only project-labelled Docker IDs and still attempts the stop. A failed state write also cannot bypass that stop. If Docker itself cannot be reached, cleanup is explicitly incomplete and you must keep the state for inspection. Sampling ends when the command completes; continuous deployment supervision and the actual box capacity proof remain later work.

The driver records only project, image and container IDs in `.local-stack/test-cloud-state.json`. Keep that file with this deployment; stopping requires those IDs and matching Compose labels. `status` and `stop` refuse unrecorded project containers, including an interrupted startup whose last state still lists no IDs. A lock file serialises commands. After an interrupted driver, inspect its recorded IDs and the project before removing a stale lock. If an unrecorded container exists, audit its creation and project label before recording or stopping it manually. A hard kill can prevent the driver from finishing its journal; an empty status is never treated as proof that the project is stopped. Do not clear state, prune Docker or use Waitron's Compose commands to make preflight pass.

## Trust the public CA

Bootstrap generates the account keys, database password, local CA and leaf private keys inside the private configuration volume. No generated secret is written into the host deployment directory. Restart keeps the same identity; partial state, changed certificates and weakened permissions fail closed.

Export only `/run/local-stack/lan/ca.pem` from a recorded Cloud container. Give that **public certificate** to your disposable browser profile and use `NODE_EXTRA_CA_CERTS` for disposable Node clients. Verify that `waitron.local` resolves to `192.168.10.10`. Keep normal certificate and hostname verification enabled. A browser certificate-warning bypass does not establish trust for passkeys.

The leaf certificate lasts thirty days and the CA lasts a year. Expired or damaged identity is refused, rather than silently replaced. In-volume renewal with the same CA remains a maintenance follow-up; do not delete the volume to obtain a new identity.

## What the local proof establishes

Run the optional real Docker tests with a locally built image containing the reviewed source and installed dependencies:

```sh
TEST_CLOUD_DOCKER_PROOF_IMAGE=<local-image> node --test \
  deploy/test-cloud/https-proof.test.mjs deploy/test-cloud/proxy-proof.test.mjs
```

The first proof starts a separate disposable Mac project with random loopback ports. It checks trusted HTTPS, normal refusal without the CA or with the wrong hostname, actual signup mail and its canonical link, proxy refusals, restart identity, account replacement without a proxy restart and a stop that preserves volumes. It then removes only its own test containers, network and volumes. The second runs the real TLS proxy against an independent backend, so backend security cannot hide a missing proxy check.

These HTTPS checks do not establish an amd64 test-box deployment, a connected Waitron venue, public remote access or measured box capacity. The separate storage proof below exercises free/paid withdrawal with signed Cloud clients. The final deployment runbook will add the two-organisation connection steps after those proofs pass. Keep the quarantined test-box venue and its containers unchanged.

## Direct storage authority

A plan change must reach storage itself because a venue can keep writing with credentials it already holds. The new private adapter records separate stream writer and recovery-reader identities, then publishes the storage permissions and checks them with signed requests. A downgrade disables the writer without discarding stored objects or its recovery reader. Explicit provisioning after an upgrade creates a fresh writer.

The plan wrapper checks the stored test venue and organisation revision before and after provider work. It also compares revisions during reconciliation, so a free-to-paid change between polls cannot restore an old writer. If the policy database fails, it withdraws existing writers before reporting the error. A failed provider reload is incomplete withdrawal; reopening reapplies the saved intent and checks the old credentials again. Missing state over an existing managed identity file is refused.

SeaweedFS 4.47 merges static identity reloads. Removing a writer from the file leaves its old key active, so the adapter replaces it with a disabled identity containing no credentials. The native storage test exercises both real refusals and the neighbouring paid venue. The persistent private issuer serves only public discovery and signing keys over trusted HTTPS; its capture and recovery policies remain restricted to the signed object scope.

Run the storage and policy checks through the isolated PostgreSQL runner:

```sh
node scripts/test-postgres.mjs exec node --test \
  deploy/test-cloud/storage-authority.test.mjs \
  deploy/test-cloud/service-runtime.test.mjs \
  deploy/test-cloud/storage-issuer.test.mjs \
  deploy/test-cloud/storage-cache.test.mjs
```

The separate expiry proof waits for a real fifteen-minute snapshot credential. It is deliberately outside ordinary CI runs:

```sh
TEST_CLOUD_REAL_STS_EXPIRY=1 node --test \
  deploy/test-cloud/storage-expiry-proof.test.mjs
```

Use `TEST_CLOUD_STS_EXPIRY_SECONDS=12` only for a short diagnostic of the provider's refusal. The output labels it separately; it cannot count as the fifteen-minute proof. The S3 request after an issued credential expires must return `403 InvalidAccessKeyId`. An expired identity token at the STS endpoint has a different error.

The corrected fifteen-minute proof passed on 18 October 2026. Its write was accepted before the recorded `02:43:00Z` expiry; the request at `02:43:01.013Z` returned `403 InvalidAccessKeyId`. This measures an issued credential at the native storage boundary. The earlier run with an incorrect error predicate remains failed evidence; the short diagnostic is separate. The delivered container proof below also obtains and uses a real scoped grant from the persistent issuer, but it does not repeat the full-duration wait.

The dedicated storage process now runs the persistent issuer and SeaweedFS in the same container. Both use the private configuration volume. Inside the project, `waitron.local` resolves to storage; clients receive `https://waitron.local:8333` with the same trusted LAN CA. Account and storage containers have no Docker socket. The account asks for reload through a private Unix socket, a local connection stored in that volume. The storage process signals only the child it started, then the adapter verifies the changed permissions with signed requests.

At restart, storage begins without venue keys. In explicit test plan mode, current policy reconciliation restores permitted writers and recovery readers before its health check passes. Dormant mode uses the ordinary local authority without reading organisation plans. Account startup waits for healthy storage. In explicit test plan mode, the dedicated account process supplies the real snapshot authority and managed-stream adapter. The deployed flag remains `0`, so this does not activate plan enforcement.

Run the delivered container layout separately with a current native image:

```sh
TEST_CLOUD_STORAGE_PROOF_IMAGE=<local-image> node --test \
  deploy/test-cloud/storage-proof.test.mjs
```

This proof sends signed requests through the trusted HTTPS proxy. Free snapshot and stream requests return `403 permission_denied`; paid requests receive distinct scoped credentials. It tests a normal downgrade and one committed while storage is stopped. After restart, old writers fail at storage, the neighbouring paid writer still works, and explicit upgrade returns a fresh writer with the original recovery key, reader and retained data. It also checks normal TLS trust from a host client. Generated fixture keys stay inside the disposable private volume, and cleanup removes only this proof's project.

The backup worker selects the same canonical storage endpoint and LAN CA in explicit test plan mode. Its dedicated controller verifies a genuine paid snapshot in the joint local proof below. Ordinary recovery still needs separate fiscal authority. These storage checks do not prove LAN publication or test-box readiness. Keep plan enforcement off until the release gates pass.

## Local remote authority

A gateway must remove a route that was already working when its organisation becomes free. In explicit test plan mode, the test project's manifest worker now runs the real remote reconciler against the project database. It signs current route manifests with the private gateway key and issues local staff and public certificates under the LAN CA. Staff requests use the existing signed account exchange; public keys and requests stay in the private volume. Dormant mode keeps the ordinary empty-route publisher.

The assigned names end in `r.waitron.local`. This short suffix keeps the generated staff name within the certificate subject limit. These are local test names, with no public DNS or outside-home reachability. A mismatch between the saved cell, WireGuard key or signing identity is refused rather than overwritten. Startup preserves the signed sequence so an earlier empty manifest cannot supersede the real routes. The schema's existing provider field remains `aws`; this local cell creates no AWS resource.

The test gateway checks readiness for both empty and populated route sets and refuses status older than five seconds. It watches public certificate files and reloads its own proxy after replacement. The ordinary gateway does not enable that watch by default. Renewal of the LAN account/storage leaf and its CA remains the separate maintenance follow-up above.

Run the real worker and gateway together:

```sh
TEST_CLOUD_REMOTE_PROOF_IMAGE=<local-image> node --test \
  deploy/test-cloud/remote-proof.test.mjs
```

The disposable Mac project keeps generated fixture keys in its private volume. Two signed clients obtain trusted staff certificates and two WireGuard peers serve distinct venue bodies. The proof also checks public TLS and the browser-challenge endpoint, live public certificate replacement, actual route/peer removal on downgrade, a paid neighbour that keeps working, explicit reprovisioning after upgrade, and withdrawal committed while the reconciler is stopped. Free provisioning and signed certificate status return permission refusal. Cleanup removes only the recorded proof project and its peers.

On 18 October 2026, the passing renewal proof observed route withdrawal in 1,162 milliseconds, including its operator-command time. An earlier clean repeat measured 4,655 milliseconds. The first run observed 1,868 milliseconds but failed during cleanup. These are local fixture observations, not a promised deadline or test-box measurements. The initial renewal check failed because the running proxy retained its old certificate; the passing check observes a different trusted certificate on a new TLS connection. A first proof also failed cleanup after listing peer IDs twice; its leftover owned network and volumes were removed before the clean repeat.

The gateway ports remain on loopback. This proof does not connect the quarantined box venue or provide public remote access. The complete local backup proof below supplies the disposable Waitron integration. Release qualification, the test box capacity proof and deployment approval still precede deployment activation.

## Backup verifier boundary

The owner-approved [backup-verification contract](superpowers/specs/2026-10-18-backup-verification-without-fiscal-authority.md)
checks whether an archive restores its data without giving Cloud permission to
activate a fiscal server. Its worked examples describe required outcomes, not
executed results. Earlier local PR5 candidate receipts reached genuine encrypted
capture and signed publication, then ordinary fiscal restore refused with
`restore.hook_failed / sif.allocation_invalid / reauthentication_required`.
The adapters have been reconciled with current Cloud main. Their earlier runtime
receipts remain historical evidence; reconciliation does not establish the new
verification path.

Waitron A850's interface landed in
[#1939](https://github.com/clintongormley/waitron/pull/1939) at
`5516dd57e9ae4c52e1a68f35f1e1860ff00e2faa`. The
[Cloud implementation plan](superpowers/plans/2026-10-21-cloud-backup-verification.md)
covers result validation, catalogue and recovery integration.
The interface's source release does not qualify a Cloud image or snapshot.
You can exercise the dormant native runner with
`pnpm --dir packages/backups exec node --test test/bound-waitron-verifier.test.ts test/verification-transport.test.ts test/verify-process.test.ts`.
It sends separate private request and key frames, checks the compiled target, and
validates output after process exit and scratch cleanup. The native path returns
only a data result; it cannot supply trusted Docker ownership evidence. Its pinned
bundle probe refused synthetic invalid bytes and a missing migration journal.
The controller accepts the exact bound request in its dormant interface. It
refuses mismatched cleanup, multiple same-token children, uncertain creation with
no discoverable child, and malformed private journals.
An unsuccessful create reply cannot prove that Docker will never create the child.
With no exact child to remove, the controller retains its intent after the deadline
and refuses restart. Do not delete that journal to resume work: a late child would
lose its ownership record. When the exact child appears, restart can remove it and
accept fresh work. Automatically settling a definitively rejected create remains
a follow-up; an unresolved outcome can stop verification indefinitely.
You can exercise the dormant Docker adapter with
`pnpm --dir packages/backups exec node --test test/bound-container-verifier.test.ts`.
It requires an immutable image ID and a matching controller scope. It checks the
actual child identity, request labels and isolation settings, waits for process
exit, then confirms removal before returning the data result and ownership
receipt. An uncertain removal overrides both passed and invalid results. Its
private request and key frames go directly to the compiled verifier; the archive
is staged once in the same quota-limited scratch filesystem. A supervisor with its own event loop stops even a CPU-blocked verifier after
its host dies, and restart reclaims only its recorded container.
The build archives the target manifest's pinned source revision, generates that
source's runtime stamp and compares the compiled complete target before producing
the local image. The pinned image refuses synthetic bad bytes and a missing real
migration journal. These checks do not establish genuine archive success or a
published release.
You can exercise the dormant database admission core with
`node scripts/test-postgres.mjs exec pnpm --dir packages/backups exec node --test test/verification-admission.test.ts test/claim-pipeline.test.ts`.
It prepares an immutable request for a live claim, then checks policy, venue, job,
point, publication metadata and the child receipt in one transaction. A blocked
write can outlast its lease or request deadline; a final time check rolls back the
whole outcome. Inconclusive checks remove current success while keeping historical
retention evidence, and a completed integrity failure remains failed. These tests
use synthetic child results to test admission; they do not prove archive recovery.
The `BackupCatalogue.verifyClaim` path connects that core to storage,
key unsealing and encrypted-stage disposal. It sends only the matching archive key
to the bound verifier and compares its measurement with the independent stage.
An inconsistent verdict, thrown error or uncertain cleanup cannot record archive
success or corruption. Cancellation during disposal still returns the retry
allowance; an expired claim changes nothing. A mismatch verdict requires
the bound child's completed measurement and confirmed cleanup.
The worker uses this path and no longer accepts callback completion as verification.
Both entry points open the bound verifier and pass its persistent controller scope.
A missing target policy leaves verification jobs unclaimed. Policy locks precede
job claims and retention venue locks, so a policy change cannot race an old claim.
When a claim has expired, verification results, cleanup errors and shutdown leave
job counters untouched.
You can check machine recovery negotiation with
`node scripts/test-postgres.mjs exec pnpm --dir packages/backups exec node --test test/recovery-v2.test.ts test/recovery-request.test.ts test/continuous-recovery.test.ts`
and the HTTP boundary with
`node scripts/test-postgres.mjs exec pnpm --dir packages/account-http exec node --test test/recovery-v2.test.ts`.
Version 2 binds the complete requested target to the fresh key and request ID.
Snapshot metadata and read grants return the selected attempt's stored descriptor,
so a retry cannot silently change targets or downgrade to version 1. Owner forms
keep their existing limits; only the machine route accepts the larger descriptor.
These tests use synthetic archive-verification evidence in disposable databases.
Every snapshot approval requires a persisted v2 request and current qualification.
Metadata, key delivery and restored reports require the exact evidence you approved;
if a newer check replaces it, approve a new operation. Replacement preparation,
completion and retrieval of its completed result enforce the same binding.
Policy locks precede venue locks. A final check after database and provider waits
prevents expired approval or changed evidence from releasing archive credentials.
A restored report alone changes no installation, backup key or route.
You can exercise these boundaries with
`node scripts/test-postgres.mjs exec pnpm --dir packages/backups exec node --test test/recovery-qualification.test.ts`
and
`node scripts/test-postgres.mjs exec pnpm --dir packages/account-http exec node --test test/recovery-qualification.test.ts`.
These are synthetic checks. Catalogue pages, verified timestamps, monitoring and
operator status use the same current evidence. An unavailable recheck keeps the
historical fallback, stored bytes and key dependencies. A completed invalid check
still counts as failed after an inconclusive retry. Delivery rechecks a queued
backup notice against the current point and the existing failure grace period.
You can run the reader and retention checks with
`node scripts/test-postgres.mjs exec pnpm --dir packages/backups exec node --test test/catalogue.test.ts test/key-operations.test.ts test/managed-streams.test.ts`
and the monitoring/history checks with
`node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/monitoring.test.ts test/history-cleanup.test.ts`.
The portal explains that a successful data restore check needs separate activation
permission. An unavailable check keeps the copy pending without calling it corrupt.
The English and Spanish browser checks cover current evidence, historical protection,
recovery controls and verified timestamps at phone and desktop widths in both themes.

You can run the schema-upgrade proof with
`node scripts/schema-upgrade-receipt.mjs /tmp/cloud-backup-schema-upgrade.json --backup-verification --old a31df0093529f5ebccc6fe3561dbcd194166ce48 --new <committed-candidate-SHA>`
and validate it with
`node scripts/verify-schema-upgrade-receipt.mjs /tmp/cloud-backup-schema-upgrade.json`.
The local run at `ee927ed9ac4486f4d9166e0c95ac661eab674bf5` passes.
Version 5 records the 42-to-43 migration, interrupted rollback, old-binary refusal,
legacy retention, matching external keys and restored v2 evidence. Its evidence is
synthetic and cannot qualify a genuine archive or release image. The earlier receipt
versions keep their original release pairs and assertions. The actual restore also
checks the new validation functions under PostgreSQL’s empty restore search path;
their nested helpers resolve in the schema where the migration created them.
The complete genuine joint proof is described below; release remains unqualified. Keep snapshots
unavailable and plan enforcement off.
You can exercise these rules with
`node scripts/test-postgres.mjs exec node --test packages/backups/test/worker-admission.test.ts packages/backups/test/worker.test.ts`.
The synthetic fixtures test admission and isolation; they cannot replace the genuine
capture-to-recovery proof below or qualify a published image.
The unavailable backup profile now mounts its own writable
`test-backup-verifier-state` volume at `/run/backup-verifier`. Configuration remains
read-only at `/run/local-stack`; only the enabled backup runtime receives
`CLOUD_VERIFIER_STATE_DIR`. The worker refuses missing, relative or overlapping
state paths before opening its database. This supplies private journal storage;
it grants no Docker socket or permission to enable the profile.
Keep snapshots unavailable and deployment
enforcement off until the implementation, full integration proof and release gates
pass. Ordinary fiscal restore still requires its existing activation authority.

An interrupted worker must recover its own verifier without removing another venue's or project's container. The dedicated test worker holds one database session lock, records each create attempt in its private volume, and uses the recorded container ID for attachment, inspection and deletion. Removal checks the owner, private project scope, attempt token and pinned image. An uncertain create reply keeps the attempt reserved; a missing journal over an existing child stops startup. After the sixty-second ownership deadline, startup can reclaim the exact recorded attempt. You must resolve an ownership refusal before restarting; deleting the journal does not authorise cleanup.

The trusted controller requires the Docker socket. The untrusted restore child receives no socket, network or host mount. Its memory is capped at 1,024 MiB, including a 256 MiB scratch filesystem. The image must have a complete image ID and the pinned Waitron revision label. The ordinary verifier retains its existing path. The backup profile remains unavailable in the deployment override, which still grants no Docker socket.

Run the controller's local Docker checks with:

```sh
TEST_CLOUD_VERIFIER_CONTROLLER_PROOF=1 node --test \
  deploy/test-cloud/verifier-controller.test.mjs
```

You can exercise genuine capture, signed publication, admission and target-bound delivery:

```sh
TEST_CLOUD_SNAPSHOT_PROOF_IMAGE=<local-cloud-image-id> \
TEST_CLOUD_SNAPSHOT_VERIFIER_IMAGE=<pinned-verifier-image-id> \
  node --test deploy/test-cloud/snapshot-proof.test.mjs
```

The current local candidate pins Waitron A1004 at
`ec91a9e34d2daba146f4ee61850ea4136ad5cfb7`. Its complete compiled target includes
all 15 owners, core schema 185 and venue-service schema 66. A1004 removes the
verification-only lock watchdog; the Cloud child still denies worker threads.
The image build compares its complete compiled descriptor with the checked-in
manifest before accepting the candidate.

The scenario captures a genuine encrypted archive, publishes it through the signed
machine API, stages it from storage and verifies it through the delivered scoped
worker. It checks committed current evidence and confirmed child removal.
The owner API selects that snapshot as its default. The scenario compiles the unchanged
pinned Waitron recovery client and ordinary restore boundary with Waitron's build
tool and runtime identity, in a separate disposable target image. Its real v2
request receives owner approval for the exact committed verification attempt.
The client obtains target info and scoped storage access, independently checks the
download's digest and size, and compares the target before staging. Ordinary restore
then reaches the unchanged `FISCAL_RESTORE` refusal without separate fiscal authority.
It sends no restored report, replaces no installation and leaves no first-start marker.
This refusal does not prove successful ordinary recovery or authorised activation.
The same run also supplies a valid descriptor for a different runtime and refuses it
before any remote read. A damaged copy of the downloaded archive is refused after
the real storage grant and before staging. Both controls preserve the recovery
state, place no data and send no restored report. This checks an alternate target;
it does not claim to have executed a second runtime binary.
The temporary target receives the LAN CA and its own recovery state through private
input; it receives no Cloud configuration volume or master key.

Continuous stream objects and database pointers are checked absent at all nine
capture-to-recovery boundaries. Only the disposable proof database opts into
release readiness; the deployment profile stays unavailable and enforcement off.

The capture fixture uses Waitron's existing synthetic certificate generator and
normal vault writer before capture. Without that certificate, the genuine archive
correctly returns `unavailable` / `secret_unavailable`. It never rewrites captured
fiscal evidence to obtain a pass. You can run the independent real-image controls
with the same verifier image:

```sh
TEST_CLOUD_SNAPSHOT_VERIFIER_IMAGE=<pinned-verifier-image-id> \
  node --test deploy/test-cloud/verifier-genuine.test.mjs
```

Those checks require every owner's passed result, refuse a wrong recovery key and
changed archive bytes, then verify the untouched original again. No activation is
attempted. These local candidates remain unpublished and unqualified for release.
The joint scenario now covers the v2 client, owner approval and target delivery.
The same run now also restores its delivered archive through the separately
authorised fixture below. Remaining refusal controls still prevent complete
certification. Earlier independent controls are not relabelled as part of this run.

You can qualify the separately authorised recovery fixture against the same image:

```sh
TEST_CLOUD_SNAPSHOT_VERIFIER_IMAGE=<pinned-verifier-image-id> \
  node --test deploy/test-cloud/verifier-authorised.test.mjs
```

This reuses Waitron's existing `archiveHost()` and `archiveCommand()` from the
[authorised fixture recipe](https://github.com/clintongormley/waitron/blob/71ea6745700bf1076eccd28c55b8e94a87411fe9/docs/developers/authorised-cloud-restore-fixture.md).
Its original synthetic archive restores, but does not pass the complete data
verifier. The Cloud fixture instead captures the same disposable source through
Waitron's backup writer after normal node-identity and test-certificate setup.
All 15 module checks then pass. It prepares a new recovery operation for these
exact recaptured bytes, using the fixture's controlled later clock, and executes
the ordinary restore. The recovered counters stay at 123; the restored series
start at 1 and the database holds two fiscal allocations. A wrong node key and a
valid key without module preparation both refuse and preserve the destination.
No venue server starts, and generated keys stay inside the disposable container.

You can check the private delivery handoff, including changed bytes, a wrong
archive key and a wrong reported digest, with:

```sh
TEST_CLOUD_SNAPSHOT_VERIFIER_IMAGE=<pinned-verifier-image-id> \
  node --test deploy/test-cloud/verifier-authorised-delivery.test.mjs
```

The joint scenario now uses that same authorised source. Its capture container
has no network. It waits while Cloud signs the publication, verifies the archive,
admits the result and delivers the selected point through the pinned compiled
v2 client. Only those independently delivered bytes and their archive key return
through a private pipe. The fixture checks them against its capture before it
prepares ordinary recovery. No fiscal authority enters the verifier or the client.

The receipt keeps the unchanged no-authority `FISCAL_RESTORE` result and adds
`authorisedRecovery` for the same run, point, attempt, digest and size. That object
records the separate ordinary fiscal activation, its retained counters and both
authority refusals. Cloud still reports no restored installation or route movement.
The placement and recovery phases cover that separately authorised operation; the
primary client's recorded placement stays `not-run` and its activation stays
`not_attempted`. Neither successful verification nor receipt certification grants
the primary client fiscal authority.

The same joint run also opens fresh verifier children for wrong-key, damaged-archive,
malformed-output, live timeout, full scratch, cancellation, forced-crash, uncertain-cleanup,
real memory exhaustion and unsupported-format controls. Each child uses the same immutable image and captured archive binding. A final
child verifies the untouched archive again. The receipt's `verifierControls` section binds
these outcomes to the admitted source request and records the distinct child IDs, claim
IDs, tokens and confirmed removal. A refused child supplies no accepted verdict. The
scratch control fills the existing 256 MiB filesystem to `ENOSPC`; it does not raise a
limit. The memory control makes the kernel kill its verifier at the unchanged 1,024 MiB
limit, including swap, and records Docker’s `OOMKilled` flag and exit 137 before removal.
The unsupported-format control changes only the declared format version to 2; the pinned
runtime returns `unsupported` with `archive_format_unsupported` for the same captured bytes.
The final child still verifies the untouched archive. These controls do not claim
to exercise a module's `needs_authority` outcome.

You can run these controls separately against a genuine disposable capture:

```sh
TEST_CLOUD_SNAPSHOT_VERIFIER_IMAGE=<pinned-verifier-image-id> \
  node --test deploy/test-cloud/verifier-same-run-controls.test.mjs
```

The test runner splits large output lines. The joint scenario therefore sends its
redacted receipt in one compressed line, capped at 16 KiB. The producer limits the
decoded receipt to 2 MiB, rejects duplicate records and still requires one executed,
passing scenario with no skips. The saved JSON remains the readable receipt.

The current producer writes a version 2 receipt from the scenario's actual committed
request, result, selected recovery attempt and client assertions. It emits the receipt
only after confirming removal of its containers, networks, volumes and scratch.
Run it with both local candidates available:

```sh
TEST_CLOUD_SNAPSHOT_PROOF_IMAGE=<local-cloud-image-id> \
TEST_CLOUD_SNAPSHOT_VERIFIER_IMAGE=<pinned-verifier-image-id> \
  node scripts/backup-verifier-proof.mjs /tmp/cloud-backup-verifier-proof.json
```

With the authorised disposable fixture, this command saves the complete local
receipt and exits with status 0. The receipt retains the primary fiscal refusal
alongside the separate successful recovery. A missing phase, failed scenario or
absent authority still refuses certification.
`scripts/verify-backup-verifier-proof.mjs` requires one run's genuine capture, signed publication, complete bound
module output, committed admission, v2 recovery and separately authorised ordinary
restore. It also checks continuous-source absence, named refusal assertions and
confirmed owned cleanup. You can validate a completed receipt with:

```sh
node scripts/verify-backup-verifier-proof.mjs /tmp/cloud-backup-verifier-proof.json
```

An explicit `FISCAL_RESTORE` refusal alone remains incomplete. Complete certification
also requires the same delivered archive's separately authorised restore and its
unchanged authority-denial checks. Local images remain
`unqualified` for publication. The historical two-venue producer and its original
resource and security assertions remain in `runLegacyBackupVerifierProof` for older
runtime investigations; they cannot certify the current version 2 contract.
Ordinary recovery keeps its separate fiscal authority requirement.
Keep snapshots unavailable and deployment enforcement off until the remaining Cloud
implementation, complete integration proof and release gates pass.
