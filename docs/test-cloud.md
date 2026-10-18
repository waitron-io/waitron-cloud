# Test Cloud on your home network

You need a separate Cloud account service to exercise your test server without touching its existing venue. The test deployment uses its own Compose project, database, storage and private configuration. Its canonical address is `https://waitron.local:3000`.

The deployment files and local HTTPS proof are implemented. **The test box is not deployed yet.** Plan enforcement remains off until the storage adapters, free-service checks and disposable Waitron integration proof pass. Address providers stay disabled. Translation stays off pending the pinned joint paging proof and owner trials after 2 November 2026. Outside-home remote access needs a separately approved domain, certificates and deployment.

## What is reachable

Only the HTTPS proxy publishes to `192.168.10.10:3000`. It forwards to the unpublished account listener and accepts the exact canonical Host and, when present, Origin. It replaces forwarding headers and the account server trusts only its private address, `10.79.0.2`. Ordinary loopback deployment keeps `http://localhost:3000`.

PostgreSQL uses loopback port 55432. This project's Mailpit uses loopback ports 1125 and 8125, leaving Waitron's 1025/8025 alone. Storage 8333 and gateway 8443/UDP 51820 also remain on loopback until their separate adapter proofs pass. The account backend keeps `10.79.0.3`, so replacing it preserves the proxy's destination without a proxy restart. The private Docker network is `10.79.0.0/24`; preflight refuses overlapping existing networks. All container memory limits, including dormant profiles, sum to 1,824 MiB. That limit is not a measurement of test-box headroom.

The explicit test email worker uses the existing account-mail templates and outbox. Its SMTP destination is fixed to loopback inside this project's Mailpit network namespace. The ordinary local and production mailers keep their origin restrictions.

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

These are local synthetic checks. They do not establish an amd64 test-box deployment, a connected Waitron venue, free/paid storage withdrawal, public remote access or measured box capacity. The final deployment runbook will add the two-organisation connection steps after those proofs pass. Keep the quarantined test-box venue and its containers unchanged.

## Backup verifier boundary

The owner-approved [backup-verification contract](superpowers/specs/2026-10-18-backup-verification-without-fiscal-authority.md)
checks whether an archive restores its data without giving Cloud permission to
activate a fiscal server. Its worked examples describe required outcomes, not
executed results. Earlier local PR5 candidate receipts reached genuine encrypted
capture and signed publication, then ordinary fiscal restore refused with
`restore.hook_failed / sif.allocation_invalid / reauthentication_required`.
That candidate code remains unpublished; this design publication adds no verifier.

Waitron A850's interface landed in
[#1939](https://github.com/clintongormley/waitron/pull/1939) at
`5516dd57e9ae4c52e1a68f35f1e1860ff00e2faa`. The
[Cloud implementation plan](superpowers/plans/2026-10-21-cloud-backup-verification.md)
covers the remaining result validation, catalogue and recovery integration.
The interface's source release does not qualify a Cloud image or snapshot.
Keep snapshots unavailable and deployment
enforcement off until the implementation, full integration proof and release gates
pass. Ordinary fiscal restore still requires its existing activation authority.

## Direct storage authority development

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

These components are not wired into the deployment yet. The issuer still needs its private volume and storage-process integration; the account and backup runtimes, gateway and verifier need the remaining PR5 work. The native fixture proofs do not establish the final LAN endpoint, a working deployed storage service, or test-box readiness. Keep plan enforcement off until the complete integration proof passes.

