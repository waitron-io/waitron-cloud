# Test Cloud on your home network

You need a separate Cloud account service to exercise your test server without touching its existing venue. The test deployment uses its own Compose project, database, storage and private configuration. Its canonical address is `https://waitron.local:3000`.

The deployment files and local HTTPS, storage, remote, backup-verifier and free-service fixture proofs are implemented. **The test box is not deployed yet.** Plan enforcement remains off until the final disposable Waitron integration and release checks pass. Address providers stay disabled. Translation stays off pending the pinned joint paging proof and owner trials after 2 November 2026. Outside-home remote access needs a separately approved domain, certificates and deployment.

## Final integration receipt work

The first PR7 component is a strict receipt reader. It rejects missing genuine-client
and free-plan refusal fields, changed protected container IDs, incomplete resource
sampling, incomplete cleanup and changed rollback identity. It keeps local translation
and relay fixtures separate from available Waitron journeys. Its tests use synthetic
receipts to check those refusals; they supply no genuine integration evidence.

Run the reader tests with:

```sh
node --test scripts/verify-test-cloud-receipt.test.mjs
```

The paired-client journey below now combines continuous recovery, independent
snapshot fallback and remote isolation and withdrawal. A separate same-image
rollback journey preserves Cloud identity and both pairings. The combined receipt
producer and final release qualification remain open. The shipping Cloud Dockerfile
now passes the separate capacity and controlled schema-change journeys below,
using a pinned disposable Waitron image. The deployment capacity gate remains open.
There is no completed PR7 receipt to validate yet. Keep plan enforcement off
before the test-box deployment.

The combined journey requires a clean committed checkout. Before starting Cloud,
it reads the selected immutable image in a disposable, networkless container and
compares every tracked runtime input under `apps`, `packages`, `deploy` and
`scripts`, plus the root dependency and Compose configuration, with that checkout.
The receipt records the commit, tree, image ID, file count and SHA-256 of this
manifest. A changed or missing image file, a symbolic link, or a checkout changed
before the run finishes refuses the result. This binds tracked source inputs;
it does not certify generated portal assets, the Waitron build or a published release.

The shipping-Dockerfile candidate at `6bdea472` passes the combined journey in
395.6 seconds, with two tests and no skips. Its image matches 1,675 tracked runtime
inputs from that clean commit. The run uses the campaign's temporary disk policy;
it leaves the shipping capacity gate and complete integration receipt open.

Run the source checks with:

```sh
node --test scripts/test-cloud-source.test.mjs
```

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

The ordinary command runs one file at a time. CI sets
`CLOUD_SERVICE_PROOF_CONCURRENCY=2` to share one queue of at most four files
across the groups, retaining every check and the same receipt fields. Values
other than `1` or `2` refuse the proof. The `Venue service proof` workflow runs
each receipt in its own eight-minute job, keeping the 330-second child and
360-second test limits. The runtime check stays with the venue receipt. To run
both receipts locally, use `node --test --test-concurrency=1
scripts/legacy-service-proof.test.ts scripts/venue-service-proof.test.ts` from a
clean, committed checkout.

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

## Check real free and paid clients

You can prove the connection before testing paid services. The client runner creates
two accounts through HTTPS signup and reads their verification links from its own
Mailpit. It leaves one account free and sets the other paid with the existing operator
command. Each account pairs a separate disposable Waitron demo venue through the
normal manager login and pairing APIs.

Use immutable local image IDs, with the reviewed Cloud source and installed dependencies
in the first image. The second is the existing Waitron verifier image pinned to
`ec91a9e34d2daba146f4ee61850ea4136ad5cfb7`. The runner builds that pinned source's
dashboard without network access and runs its unchanged integration fixture with
its installed TypeScript loader. It creates no host venue or private key file.

```sh
export TEST_CLOUD_INTEGRATION_IMAGE=sha256:<your-reviewed-cloud-image-id>
export TEST_CLOUD_INTEGRATION_WAITRON_IMAGE=sha256:<your-pinned-waitron-image-id>
export TEST_CLOUD_PROTECTED_CONTAINER_IDS='["<full-container-id-to-preserve>"]'
node scripts/test-cloud-integration.mjs > /tmp/cloud-client-integration.json
```

List the existing containers whose running state and start time must remain unchanged.
Another lane may finish its own temporary containers during the proof. The runner
checks only your listed protected IDs and removes only resources it created.
If Docker refuses to remove one resource, cleanup still attempts the others and
the command refuses to issue a receipt. Preserve the exact remaining ID for
inspection. A retained network can reserve the stack's subnet even when Docker
lists no connected containers; arrange recovery of the shared Docker service
with the owner instead of pruning or restarting other lanes' workloads.

Both venues use `https://waitron.local:3000` with the project's public CA and normal
certificate verification. The proof also tries an untrusted CA and a wrong hostname;
both refuse. It observes successful signed pairing, renewal and configuration
responses, checks the persisted Cloud binding, and restarts each venue without
changing its local identity or installation. The real free client's snapshot reserve
returns `403 permission_denied`, with no grant or key. Private connection state stays
in disposable volumes; the receipt contains only IDs, hashes and fixed outcomes.

This command proves the client journey only. Its receipt has
`kind: "test-cloud-clients"` and `completeIntegration: false`. You still need the
same installations' paid snapshot and stream recovery, independent snapshot fallback,
remote withdrawal, measured resource budgets and complete rollback proof before the
final integration receipt can pass. Keep deployment plan enforcement off.

To exercise the paired paid venue's archive upload as well, use the same image
variables with:

```sh
node --test scripts/test-cloud-paid-snapshot.test.mjs
```

This extension passes on the isolated Linux test box with disposable Debian
images and the pinned Waitron source above. Its unskipped test observes genuine
capture, scoped upload, signed publication and an independent stored-byte check.
The eight native evidence checks and nine deliberate check omissions separately
qualify the evidence reader. Neither proof qualifies the pinned Alpine release
or ordinary recovery.

The campaign runner uses the owner's approved 10 GiB free-disk floor at start
and during this test-box run, with the existing memory limits and deadlines.
Across 28 samples, including both clients and capture, available memory stays
above 3,748 MiB and free disk above 15.67 GiB. No out-of-memory kill is observed.
These measurements do not cover an active verifier. The deployment helper keeps
its separate capacity checks.

The extension prepares backup state in the paid demo venue's own volume, trusts
that venue's public CA for its manager API and uses its existing signed Cloud
connection. After capture, upload and publication, Cloud independently reads the
stored object and compares its bytes, hash and source binding. Deliberately wrong
digest, organisation and source-node claims must refuse. A passing result still
records verification as pending and recovery as not run; the final receipt reader
continues to reject it as incomplete.

Inside the disposable venue, the account hostname points to the HTTPS proxy.
The storage client connects to the separate storage service while keeping the
canonical URL, signed host and TLS certificate name. Cleanup removes the owned
project, clients, volumes and image tags; the three existing Waitron containers
keep the same IDs, start times and health.


To include the delivered backup worker in the paired journey, run:

```sh
node --test scripts/test-cloud-paid-verification.test.mjs
```

This extension installs a test certificate in the disposable paid venue through
Waitron's normal vault writer before capture. The pinned fiscal verifier requires
that credential to check a complete preproduction archive. The fixture does not
change invoice allocation or captured fiscal records.

The real test worker reads the published object and delivers it to its bounded
verifier child. The independent evidence check requires the same paired source,
archive bytes and hash, pinned target and all 15 module results. It also requires
current catalogue admission, confirmed child cleanup and no activation attempt.
The trusted worker alone receives the Docker socket. Its verifier child keeps
its existing network, filesystem and resource restrictions.

The receipt records the worker's clean stop, the absent verifier child and that
child's ID in both cleanup lists. It checks that the source installation has no
replacement and that no recovery operation was created. Recovery still records
`not-run`, and the final integration reader still rejects this partial result.
Keep deployment plan enforcement off until the remaining PR7 checks pass.


This extension passes on the isolated Linux test box without skips in 125.2
seconds. Its 30 resource samples include the exact verifier child, with at least
3,627 MiB available memory and 12.38 GiB free disk. The 36 evidence checks and nine
cleanup-ownership checks pass locally; removing any of their 34 guards fails its
tests in a fully installed disposable checkout. These results cover this small
paired archive. You still need the full settled capacity checks, remaining
recovery journeys and pinned Alpine release qualification.

To exercise owner-approved recovery of that same paired archive, run:

```sh
node --test scripts/test-cloud-paid-recovery.test.mjs
```

This extension stops the disposable source and creates a separate recovery target.
The owner approves the verified snapshot through the normal HTTPS account API.
The compiled version 2 client downloads it and independently measures its digest
and size before placement. A summary-only response keeps archive bytes and keys
inside the target; the existing private-delivery fixture remains available to
its original caller.

The target must refuse an altered runtime before making another remote read and
must refuse damaged archive bytes before placement. It then stages the genuine
archive and attempts an ordinary restore without fiscal authority. Waitron's
fiscal hook must refuse with `FISCAL_RESTORE`. Successful data verification and
owner approval to download do not grant permission to activate fiscal state.

Cloud must still report the operation as pending. An independent database read
binds that state to the same organisation, venue, point, current verification
attempt and target. Deliberately wrong point, attempt and digest claims refuse.
The test closes the operation, restarts the original source and checks its saved
identity. It records neither restored status, replacement nor activation.

This check qualifies the download and refusal boundary. Use the extension below
to test recovery with separately prepared fiscal authority. Stream recovery and
independent snapshot fallback, remote isolation and withdrawal, complete capacity
checks, rollback and the pinned Alpine release remain open. The complete
integration reader continues to reject this partial result, and deployment plan
enforcement stays off.

The recovery-boundary test passes on the isolated Linux box without skips in
146.5 seconds. Its 35 resource samples stay above 3,462 MiB available memory and
15.22 GiB free disk, with no out-of-memory kill among the sampled containers.
All 18 native recovery-evidence checks pass; removing each of their 17 guards
fails its tests in an installed disposable checkout. These measurements still
do not qualify the full settled or active-verifier capacity budget.

To prove ordinary recovery of the same paired snapshot with separate source
authority, run:

```sh
node --test scripts/test-cloud-paid-authorised-recovery.test.mjs
```

This extension creates the source's membership identity and recovery key through
Waitron's normal helpers before capture. The verifier then checks that actual
archive. After owner approval, the compiled version 2 client delivers it privately
inside the target, before the deliberate fiscal refusal. Archive bytes and keys
stay inside the disposable containers.

The ordinary restore fixture reads the source's installation codes from the
delivered database and prepares recovery for those exact bytes. It uses the
pinned source's generated release stamp and a local clock observation. It first
proves that the source's hour is refused, then advances only the isolated test
process's clock to the following hour. This is a simulated later-hour recovery;
your host and the source server retain their real clocks.

The wrong source recovery key and a restore without preparation must still refuse before
placement. The prepared restore must succeed, pass SQLite's integrity check and
preserve the source's sales, lines, tenders, settlements, fiscal records and
submissions. This uses a fresh demo venue; it does not qualify recovery of an
existing trading history. The restored node and venue must match the paired
source. No server starts, no Cloud credentials are restored and Cloud receives no
restored report or replacement request. The original source restarts with its
saved identity after the recovery operation closes.

The complete Linux journey passes without skips in 168.6 seconds. Its 39 resource
samples stay above 3,330 MiB available memory and 12.40 GiB free disk, without a
sampled out-of-memory kill. Sixteen native evidence checks pass and catch all 15
deliberate evidence-guard omissions in an installed disposable checkout. These
measurements do not qualify the full settled or active-verifier capacity budget.
Keep deployment plan enforcement off until the remaining integration and release
checks pass.

To capture a continuous stream from that same paired paid source, run:

```sh
node --test scripts/test-cloud-paid-stream.test.mjs
```

Use the same explicit image inputs as the snapshot proof. This opt-in image adds
checksum-verified Litestream 0.5.17 for Linux x86-64. The disposable venue forwards
its canonical Cloud hostname to fixed API and storage services through private TCP
bridges. These bridges carry TLS bytes; the clients still verify the certificate
and hostname and sign requests for the original HTTPS destination.

The fixture supplies the setup steps for the pinned source; it does not qualify
an automatic managed-stream setup journey. It seeds the source's normal membership
document, obtains managed stream
configuration through the existing signed machine protocol and saves the bucket
through Waitron's management API. It waits for the native stream host to confirm
an upload. Cloud must then observe the source's signed generation, the identifier of one
uninterrupted stream. A separate
account process reads it again through Cloud's normal observer, checks the same
source and venue, and independently reads the retained verified snapshot's bytes.
False source, generation and observation-time claims must refuse.

The ordinary snapshot recovery path still runs with its separate source authority.
This stream observation does not qualify continuous restore or a snapshot fallback
with continuous data absent. Use the following extension for those checks. Remote
boundaries, complete capacity, rollback and the pinned release remain before
deployment plan enforcement.

The Linux journey passes one case without skips in 169.5 seconds. Its 38 samples
stay above 3,351 MiB available memory and 13.21 GiB free disk, without a sampled
out-of-memory kill. The same run completes separately authorised snapshot recovery.
Thirty-four focused local checks cover stream evidence, private transport, retained
snapshot evidence and filtered diagnostics. Removing each of 28 guards in installed
disposable copies fails the owning checks. Full settled and active-verifier capacity
remain unqualified.

To exercise the existing owner-approved continuous recovery protocol from the
same paired source before trying independent snapshot fallback, run:

```sh
node --test scripts/test-cloud-paid-continuous-recovery.test.mjs
```

Use the same explicit image inputs. This extension asks Cloud for a version 1
continuous recovery kit, stops the source and passes the kit to the pinned
Waitron bucket restore engine. The separate source recovery key supplies ordinary
recovery authority. Independent database reads must confirm that Cloud keeps the
operation pending until you close it, without replacing the source installation.
The later fallback removes only this disposable test's stream objects and pointer
row, then requires the original verified snapshot and its stored bytes to remain
unchanged during snapshot recovery.

The extension passes one real Linux journey without skips in 254.4 seconds.
Both restore paths preserve the source node, venue and six record tables. The
continuous restore also checks the exact missing-preparation and wrong-key
refusals. A refused restore may leave the copied database in place, but must leave
no trading identity, first-start marker, Cloud connection or ready file. The same
record and identity checks apply after the wrong-key refusal.

The two clients share Cloud's recovery request limit. The combined runner waits
61 seconds after closing continuous recovery before starting the snapshot
handshake, so the earlier client's request window can expire. It generates fresh
signed requests after that wait. The production limits and refusal checks remain
unchanged. Without that gap, the combined check reached HTTP 429 on its final
snapshot information read, before placement.

The fallback checks absent stream objects and pointers before its request, after
its read and after its separately authorised restore and closure. No server
starts, no source installation is replaced and Cloud receives no restored report.
The 55 resource samples stay above 3,337 MiB available memory and 13.42 GiB
free disk, without a sampled out-of-memory kill. Owned resources are removed and
the three protected Waitron containers remain unchanged.

This proof uses a fresh demo venue and disposable Debian measurement images.
Only the isolated recovery target's clock advances. Existing trading history,
the shipping Alpine release, remote boundaries, full settled and active-verifier
capacity, rollback and the complete combined receipt remain unqualified. The
complete integration reader still refuses partial evidence, and deployment plan
enforcement stays off.


To exercise remote refusals from the paired free venue, run:

```sh
node --test scripts/test-cloud-free-remote.test.mjs
```

Use the same immutable Cloud and pinned Waitron image inputs. The operator
provisioning call must refuse `permission_denied`. The venue creates its staff
certificate request with Waitron's native helper, keeping the private key in its
own state directory. It signs submit and status requests with its actual pairing
key and lease. Both must return `403 permission_denied`; a damaged signature must
return `401 invalid_proof` so authentication failure cannot stand in for a plan
refusal. Cloud independently validates the certificate request's signature and
hostname, then reads the database again. No placement, hostname, certificate
request or remote job may exist, and the installation's remote configuration
must be unchanged.

One real Linux journey passes without skips in 107.3 seconds. Both signup-created
venues still pair, renew, fetch configuration and retain their identity after
restart. Its 26 resource samples stay above 3,984 MiB available memory and
12.80 GiB free disk; owned resources are removed and the protected Waitron
containers remain unchanged. The receipt contains only public observations.
The paired paid extension below covers LAN routes, staff/public isolation and
withdrawal after worker restart. These small journeys do not qualify full
capacity, rollback, the shipping release or deployment activation.

To exercise the paired paid venue through the LAN gateway, run:

```sh
node --test scripts/test-cloud-paid-remote.test.mjs
```

Use the same immutable Cloud and pinned Waitron image inputs. The runner first
repeats free remote refusals, then provisions the paid installation with a peer
key created inside its actual venue. Waitron's native helpers create the staff
certificate request and install the returned certificate. The fixture signs the
existing submit/status protocol with the pairing key and current lease. The
pinned Waitron source has no automatic exchange caller, so this is explicit
fixture orchestration. A TLS adapter forwards requests to the running demo
venue, and a real WireGuard peer connects it to the gateway. The adapter supplies
no application responses. You can also combine remote access with snapshot
publication or both recovery paths on the same HTTPS venue, as shown below.

The staff route returns the venue's native availability response and requires
authentication for its private status path. The public route refuses that
private path with HTTP 404. Its availability path requires the browser challenge;
the fixture solves it locally and then gets the same native response. This
qualifies the protocol, not a browser session. Both free-neighbour hostnames
refuse, and untrusted or wrong-host certificate checks fail. The staff
certificate observed through the gateway matches the one installed in the venue.

The runner stops its remote worker while the paid route is live, changes that
organisation to free and restarts the same worker. It checks a newer actual
start time, staff/public refusal, peer removal and a healthy gateway. It then
replays the exact signed configuration request admitted while paid; the reply
must mask the old remote configuration. A new signed certificate-status request
must return `403 permission_denied`. Fresh native configuration is also empty,
and both the Cloud installation and paired venue identity remain intact.

One real Linux journey passes without skips in 115.0 seconds. Withdrawal takes
2.064 seconds from the plan setter's return, including worker startup. Its
27 samples stay above 3,860 MiB available memory and 13.92 GiB free disk. Owned
resources are removed and the three protected Waitron containers remain
unchanged. These disposable Debian images and the partial receipt do not qualify
the shipping Alpine release, full settled or active-verifier capacity, rollback,
the complete producer or deployment activation. Plan enforcement stays off.

To publish a snapshot and exercise remote access from the same paid venue, run:

```sh
node --test scripts/test-cloud-paid-snapshot-remote.test.mjs
```

Use the same immutable image inputs. This journey starts the HTTPS venue used
for real backup capture, publishes its encrypted archive, then checks the remote
routes and paid-to-free withdrawal against that same paired installation. The
adapter trusts the venue's own certificate authority when forwarding HTTPS
requests. Native checks reject missing or unrelated trust and the wrong hostname;
they also check HTTP forwarding for the simpler demo venue.

One real Linux journey passes without skips in 132.4 seconds. Its 31 samples
stay above 3,600 MiB available memory and 14.30 GiB free disk. Remote withdrawal
takes 2.201 seconds from the plan setter's return. The archive remains pending
verification and this journey performs no recovery. Owned resources are removed
and the three protected Waitron containers remain unchanged. The next journey
combines recovery with remote access. Full capacity, rollback, the shipping Alpine
release and the complete receipt remain open. Keep plan enforcement off.

To exercise both recovery paths before remote access on the same paired source,
run:

```sh
node --test scripts/test-cloud-paid-recovery-remote.test.mjs
```

Use the same immutable image inputs. This journey verifies the published archive,
restores the continuous copy, removes that test's stream and restores the unchanged
snapshot with separate source authority. It then restarts the original source,
checks its remote routes and withdraws them after downgrade and worker restart.
The free neighbour must still refuse both backup and remote access. Both recovery
operations close without starting a recovery target's server, replacing the source
or sending a Cloud restored report.

One real Linux journey passes without skips in 290.8 seconds, within the unchanged
300-second limit. Remote withdrawal takes 2.639 seconds. Its 63 resource samples
stay above 3,213 MiB available memory and 12.55 GiB free disk, with no observed
out-of-memory kill. Owned cleanup and the protected Waitron containers are checked.
This fresh demo and isolated recovery clock do not qualify existing trading
history. Shipping-image capacity, schema-changing rollback and the strict complete
receipt remain open. Keep plan enforcement off.

## Measure settled and active-verifier capacity

You need measurements while Cloud is settled and while its verifier runs; container
memory limits alone do not establish actual use. On an isolated Linux Docker host,
with the same immutable image variables and protected-container list above, run:

```sh
node --test scripts/test-cloud-capacity.test.mjs
```

The opt-in journey pairs both venues, publishes the paid archive, samples a full
settled minute, then runs the existing worker against those same bytes. It reads
Linux memory accounting directly, including temporary files in memory, and measures
each owned data volume once. It requires Cloud at or below 2,048 MiB, at most one
1,024 MiB verifier, temporary memory at or below 256 MiB and fixture data at or below
1 GiB. A missing active child, a sampling gap above five seconds, an out-of-memory
kill or a protected-container change refuses the result. A measurement failure stops
the owned worker and waits for its operation to finish before project cleanup.

The disposable test-box run measured 62.4 settled seconds and two samples of the
exact admitted verifier child. Its 27 samples were at most 3.1 seconds apart.
Peak Cloud memory was 999.3 MiB; the verifier used 174.5 MiB, including 15.8 MiB of
temporary memory. Owned volume data stayed below 197 MiB, with at least 3,637 MiB
available host memory. The journey passed in 189.3 seconds under its 300-second
limit, and its resource cleanup completed.

This is a disposable Debian-image measurement under the owner's campaign-only
10 GiB disk policy. It leaves `completeIntegration` and `shippingQualification`
false. You still need the pinned Alpine release, its deployment capacity check,
schema-changing rollback and the complete integration receipt. Keep enforcement off.

### Host disk measurements during the capacity proof

The disposable capacity journey records available host memory and disk before it
creates containers, in each settled and verification sample, and after owned
cleanup. Disk is measured on the filesystem containing Docker's data directory,
reported by `docker info`, so a checkout on another disk cannot supply the result.
Missing memory data, an inaccessible data directory or a relative directory
refuses the run.

A shipping-Dockerfile capacity run on the test box passed in 200.1 seconds under
the unchanged 300-second limit. It records 27 samples with gaps at most 3.2
seconds and 62.6 settled seconds. Free disk is 15.54 GiB before startup, at least
15.32 GiB during measurement and 15.53 GiB after cleanup. Available memory stays
above 3,887 MiB during the measured window. Peak Cloud memory is below 879 MiB; the
verifier stays below 184 MiB, including 19.7 MiB of temporary memory. Both samples
of the active verifier identify the admitted child.

The journey also records a separate `capacity.startup.samples` sequence from
before Compose allocates containers through a final reading after readiness.
It measures the same host disk, memory, owned container memory and private-volume
sizes as the settled window. Missing readings, a gap over five seconds, budget
violations or changed protected containers refuse startup. The sampler stops and
waits for its own startup operation before cleanup, so Compose cannot continue
creating containers during cleanup.

A later shipping-image run passed in 195.2 seconds, without skips, under the
unchanged 300-second bound. Twelve startup readings span 18 seconds, with gaps
at most 3.3 seconds; the final reading follows readiness. The same project then
records 62.9 settled seconds and two active-verifier samples. Free disk starts
at 14.25 GiB and stays above 14.04 GiB. The first startup run refused a generic
Docker exec. A diagnostic repeat does not reproduce that refusal; its cause
remains unknown. Keep its failed receipt and capture the refused command's
category and container state on its next occurrence.

These measurements do not qualify the full deployment. The receipt continues to
report `shippingQualification: false` and `completeIntegration: false`. Whole
integration sampling, direct-storage withdrawal, published-release upgrade
and the unchanged 20 GiB startup / 15 GiB running floors remain required.

## Stop and restart Cloud without losing pairings

You can check a same-image rollback without extending the combined recovery test:

```sh
node --test scripts/test-cloud-rollback.test.mjs
```

Use the same immutable image inputs. The journey stops only its recorded running
Cloud containers and preserves their volumes. It restarts the same containers,
reads the proxy's newly assigned loopback port and checks trusted HTTPS again.
Image IDs, volume bindings, the schema ledger, private runtime configuration and
public CA must match their observations before stopping.

Both paired venues must then complete fresh successful renewal and configuration
requests with their original identities. A private fixture queues the native
renewal request without replacing the saved lease; Waitron's unchanged client
signs, sends and saves it. This explicit fixture step exercises renewal while the
existing lease is still valid. It does not qualify automatic lease expiry.

One Linux journey passes without skips in 122.4 seconds. All 11 Cloud containers
restart, and both pairings survive. Its 29 resource samples stay above 3,903 MiB
available memory and 13.98 GiB free disk, with no observed out-of-memory kill.
Owned cleanup and the protected Waitron containers are checked. This proof makes
no schema change. A schema upgrade still needs its matching private database,
configuration and storage backup/restore proof. Shipping-image capacity and the
strict complete receipt remain open. Keep plan enforcement off.

## Restore the matching private volumes after a controlled schema change

A database backup alone cannot recover the configuration keys and stored objects
that belong with it. Check their recovery together in a disposable project:

```sh
node --test scripts/test-cloud-schema-rollback.test.mjs
```

Use the same immutable image inputs as the other client journeys. The proof stops
the recorded Cloud containers, then saves the configuration, PostgreSQL, storage
and gateway volumes into a private backup volume. It records archive checksums,
file contents, ownership and permissions. Before replacing any volume, it checks
all four archives and their extracted contents.

With only PostgreSQL running, the fixture adds a disposable table and migration
entry. The normal consumer schema gate must refuse that database. It also changes
the private configuration file and adds a storage marker. After another stop, the
proof restores the complete saved set and checks the original schema before
starting Cloud consumers. Their image IDs, volume bindings, runtime configuration
and public CA must match their earlier observations.

Both original paired clients must then complete fresh native renewal and
configuration requests. The longer outage can leave a request pending in Waitron's
ordinary background worker. The fixture first asks the unchanged native client
to complete its saved work, then queues its explicit renewal. The existing check
that refuses to overwrite pending work remains in place.

One Linux journey passes without skips in 134.6 seconds. Its 31 outer resource
samples stay above 3,936 MiB available memory and 12.08 GiB free disk. This uses
the campaign's temporary disk policy and supplies no shipping capacity approval.
The schema change is a controlled fixture; an upgrade between published releases
still needs its release qualification. The complete producer receipt, pinned
Alpine image and deployment remain open. Keep plan enforcement off.

If a post-rollback renewal refuses, use its filtered diagnostic to find the failed
step. For example, `integration.rollback_refused:drain:cloud.busy` means the native
client found another operation holding the same saved-state lock before it could
drain pending work. `prepare` identifies the private renewal preparation; `renew`
identifies the subsequent native refresh. Only fixed step names and known error
codes cross the private socket and command boundary. Unknown errors become
`unknown`; their messages and saved credentials stay private.

A Linux run reproduced that lock conflict during the drain. The fixture now waits
up to two seconds for `cloud.busy` to clear on each native refresh. Other errors
still refuse immediately, and persistent contention keeps its diagnostic. The
pending-request check still prevents preparation from replacing saved work. A
separate disposable control forces overlapping genuine native refreshes; its
complete restore journey passes in 137.7 seconds under the unchanged 300-second
limit. The normal journey also passes in 131.0 seconds with the same paired-client
and matching-volume checks. An earlier undiagnosed refusal remains historical evidence without an
assigned cause; this result does not identify that earlier occurrence.

## Check the shipping Cloud image in isolation

A disposable probe image can hide a missing Alpine dependency. Build Cloud with
the [shipping Dockerfile](../deploy/local-stack/Dockerfile), then use that immutable
image for the existing capacity and matching-backup journeys:

```sh
node --test scripts/test-cloud-capacity.test.mjs
node --test scripts/test-cloud-schema-rollback.test.mjs
```

The candidate built from Cloud commit `765417e043b8d1eccd0c51de6997bf2ec81bcba9`
matches all 1,676 recorded runtime source inputs inside the image. On the isolated
Linux box, capacity passes in 198.4 seconds and controlled rollback in 131.4 seconds,
each under its existing 300-second limit with no skips. Capacity has 26 samples,
62.5 settled seconds and gaps no larger than 3.2 seconds. Observed Cloud memory
peaks at 996.9 MiB; one sample observes the admitted verifier at 140.5 MiB, with no
temporary-memory use observed in that sample. Owned volume data stays below
197 MiB, and available host memory stays above 3,983 MiB in the capacity samples.

Rollback restores the same four private volumes, removes the controlled extra
migration and completes fresh exchanges from both original pairings. Independent
cleanup checks find both disposable projects and all 39 recorded container IDs
absent, with the three existing Waitron IDs, start times and health unchanged.

These runs use the campaign-only 10 GiB disk policy and a disposable Debian-based
Waitron image pinned to `ec91a9e34d2daba146f4ee61850ea4136ad5cfb7`. They establish
compatibility with this Cloud image, while `completeIntegration` and
`shippingQualification` remain false. You still need the combined receipt,
published-release upgrade checks and deployment qualification under the unchanged
20 GiB start and 15 GiB running disk limits. Keep plan enforcement off.

## Run the journeys in one project

Separate successful runs cannot show that recovery, remote withdrawal and rollback
leave the same pairings usable. With the immutable Cloud and Waitron image variables
from the earlier commands, run:

```sh
node --test scripts/test-cloud-combined.test.mjs
```

This command requires continuous recovery, independent snapshot fallback, free remote
refusals, paid remote withdrawal, settled and active-verifier capacity, and matching
database/configuration/storage rollback in one disposable project. Its ten-minute
limit covers all those stages; the separate journeys keep their existing limits.

The combined command also collects `capacity.integration.samples` from before the
client journeys through the final rollback exchange. Each reading names its stage,
so you can distinguish recovery, remote withdrawal and rollback from the separate
settled window. Missing readings, gaps over five seconds, resource-budget failures
or changed protected containers stop and drain the owned journey before cleanup.
The complete receipt and shipping deployment qualification remain separate gates.

Another queued archive can become eligible while the selected archive is being
verified. The fixture runs ordinary one-job worker commands until the selected
archive is admitted, then waits for shutdown without taking another job. It still
requires every verifier child to be absent before shutdown. Capacity inspection
accepts a child removed between listing and inspection only after confirming that
its exact ID is absent. A present child, an unavailable Docker daemon or a malformed
inspection still refuses the measurement.

The combined journey passes on the isolated Linux box in 385 seconds without skips.
It measures 62.2 settled seconds, observes the admitted verifier, withdraws remote
access in 5.8 seconds and completes fresh exchanges from both original pairings after
restoring four volumes. Available memory stays above 3,666 MiB and free disk above
12.65 GiB under the campaign-only disk policy. Its output keeps
`completeIntegration: false`; the strict complete receipt, published-release upgrade
and deployment checks remain open. Keep plan enforcement off.
