# Parallel storage-cache fixture failure on main

Main [run 39943355021](https://github.com/waitron-io/waitron-cloud/actions/runs/39943355021)
rejected one of two fixtures in `deploy/test-cloud/storage-cache.test.mjs`; that rejection
had no error detail, so its cause is unknown. Separate readiness, handoff and S3 gRPC port
failures were found and repaired; they do not establish it. Keep the read-only archive and
two-success checks, the single restart and every deadline. Attribute a recurrence from the
retained diagnostics.

HTTP admin fallback exhaustion and a collision after the availability check are unproved:
reproduce either before changing reservations or widening retries
(`node --test deploy/test-cloud/storage-admin-ports.test.mjs`). Real token issuance and
expiry, concurrent valid-cache publication, general readiness and cleanup under every
filesystem refusal keep their own qualification. The `scripts/ci-backup-storage-*.test.mjs`
suites hold the refusal controls.

## Storage archive download failure reporting (D441)

Open; historical cause unknown. A Test Cloud plan-enforcement check (run 40775240637) failed
with an interrupted HTTP/2 response whose request is unknown, and
[PR794's root shard](https://github.com/waitron-io/waitron-cloud/actions/runs/41182674171/job/124483174725)
raised `fetch failed` fetching the pinned archive. The fixture now labels the phase (headers,
status or body) and keeps one attempt with a 30-second deadline. At a new recurrence, inspect
the named request and phase before changing transport, startup or the single attempt. Do not
repeat the passing cold-cache baseline without a new failure.

## Cooperative native storage port ownership

Each fixture claims eight ports on the filesystem before binding and holds them until its
child stops. Other programs, native fallback choices, default admin listeners and outgoing
connections can still take a port; those causes, and the historical competing processes, are
open. Different kernel port ranges and competing outgoing traffic need a controlled
Linux comparison. A driver killed before native launch can leave a fixture directory
or claims behind. The historical 55-second slowdown still has no cause. Compose and
Test Cloud publish no admin port on the host. Their SeaweedFS 4.47 image accepts admin
gRPC connections from container peers and uses a different release from the native checks.

## Current browser and identity-port qualification (D499)

The identity server now binds on port zero, which removes the demonstrated handoff race. The
historical `EADDRINUSE` bind ([run 40990548896](https://github.com/waitron-io/waitron-cloud/actions/runs/40990548896)),
the peer in the [D548 merge run](https://github.com/waitron-io/waitron-cloud/actions/runs/41221742864/job/124597610947)
and the original browser reconnect cause remain unproved. Identity-server errors after
startup need separate qualification. The owner approved the three TLS-refusal cases needing
zero TCP probes. Browser journeys: `pnpm test:cloud-cost:conformance --only
remote-browser-conformance.test.mjs`.

## Extraction-refusal seed acquisition (D530-4)

The [recorded CI failure](https://github.com/waitron-io/waitron-cloud/actions/runs/42033259367/job/127266525049)
aborted a seed download after 30 seconds without recording its phase, and
[PR #1256's root partition 2](https://github.com/waitron-io/waitron-cloud/actions/runs/43997929253/job/133754693086)
later exhausted three header attempts while another seed in the same job succeeded in
26 seconds. The provider cause is unknown. Seeds now share one bounded acquisition; capture a
labelled failure before attributing it.

## Every SeaweedFS archive fetch and a controlled-copy proposal (D530-4)

| Acquisition site | Current boundary |
| --- | --- |
| `scripts/fixtures/storage-tar-seed.mjs` | Shared test acquisition: at most three temporary attempts within 30 seconds, ten-second inactivity, exact digest, read-only cache. |
| `scripts/ci-backup-storage-{concurrent-extraction,concurrent-publication,extraction,issuer-bind,process-extraction,publication,readiness-diagnostics,reservation-refusals,tls-refusals,tar-refusals}.test.mjs` | Each setup uses that helper and removes its own returned seed directory. Existing setup and test deadlines remain. |
| `scripts/fixtures/storage-archive-download.mjs` | Shared header/body supervision and caller-selected attempt policy. Native startup uses one attempt and a 30-second total deadline; seeds retain three attempts, 30 seconds total and ten-second inactivity; conformance retains three attempts, 120 seconds total and 30-second inactivity. |
| `scripts/backup-storage-fixture.mjs` | Shared supervision on a cache miss. Original header/status/body diagnostics and causes, digest validation, atomic cache publication and extraction stay with the native fixture. |
| `scripts/cloud-cost/conformance-prepare.mjs` | Calls `downloadConformanceArchive` through the shared helper, retaining up to three attempts, a shared 120 seconds and 30-second inactivity. Verified bytes are written into its private image context. |
| `deploy/local-stack/Dockerfile` | The `storage-tools` stage copies and runs the shared Node command inside the image: at most three temporary attempts within 30 seconds, ten-second inactivity and stage records. Version 4.47, the supplied architecture digest and extraction remain mandatory. |

Full application image preparation remains a separate qualification, as does arbitrary hook
pre-emption. The wider evidence (nightly run `42042160125` job `127302872285`, general run
`42042160180` job `127296533572`) records 504 replies, status refusals and a 60-second handoff
cancellation; nothing establishes one cause.

### Controlled-copy proposal, deferred by the owner

The owner has not authorised a copy. Keep the costing below as a proposal.
D585 must measure whether wider retry pauses help only after GitHub is healthy;
its current one- and two-second pauses remain unchanged. Count any new archive
failures after consolidation and incident recovery before revisiting this proposal.

Recommend evaluating a Cloud-owned R2 Standard bucket behind a custom domain
for the exact approved archives, rather than fetching upstream release assets
in each test job. Publish only checksum-verified, versioned bytes, preserve the
upstream notices, and keep the existing digests as the final check. Switching
all remaining acquisition edges and the historical fixture needs its own scoped
change. No bucket, domain, upload, publishing credential or endpoint change is
part of this repair.

The upstream release API lists 42,495,103 bytes for macOS ARM64, 45,801,355 for
Linux x64 and 40,359,016 for Linux ARM64: 128,655,474 bytes in total, about
0.129 GB. This is asset metadata, not a new qualification of all three binaries.
Assume at most 100,000 reads and ten writes per month, one version retained and
an existing owned domain. That read volume could transfer about 4.58 TB if every
read downloads the Linux x64 archive; this is a sizing example, not measured CI
traffic.

At the [R2 prices checked on 5 November 2026](https://developers.cloudflare.com/r2/pricing/),
this fits the unused monthly allowances of 10 GB storage, ten million reads and
one million writes, giving a $0 storage/request estimate with no egress charge.
If those shared allowances are already exhausted, rounding each added meter up
gives a conservative incremental estimate of $0.38 in a steady month, or $4.88
in a month with the assumed writes, before tax and other account usage. Those
figures use $0.015 per GB-month, $0.36 per million reads and $4.50 per million
writes; they exclude domain or optional edge-product charges.

Use a [custom domain](https://developers.cloudflare.com/r2/buckets/public-buckets/)
for cache controls; the managed development hostname is a different service
boundary. A public GHCR artifact is an alternative with [currently free
container storage and bandwidth](https://docs.github.com/en/billing/concepts/product-billing/github-packages),
but it retains GitHub as the provider. The R2 proposal separates this archive
boundary from GitHub release downloads; it does not make CI independent of
GitHub or remove the need to qualify mirror access. Pricing, account allowance,
publication authority and the exact consumer change remain owner decisions.

## Native storage admin fallback exhaustion (D506)

Service ports now sit outside the automatic ranges (Linux 61000–65535, Mac 32768–49151), and
the admin cases choose listeners that cannot take one. This does not attribute the historical
failures or measure recurrence. Open:

- Refused ports whose owner is another unidentified `weed` or Node process:
  [9b7c540a](https://github.com/waitron-io/waitron-cloud/actions/runs/41850829904/job/126652888279),
  [PR790](https://github.com/waitron-io/waitron-cloud/actions/runs/41172266544/job/124452925371),
  [PR793](https://github.com/waitron-io/waitron-cloud/actions/runs/41182496471/job/124482642911),
  [PR795](https://github.com/waitron-io/waitron-cloud/actions/runs/41187136562/job/124496295046).
  The competing socket on
  [41422295053](https://github.com/waitron-io/waitron-cloud/actions/runs/41422295053) is also
  unidentified, and the port drawn in
  [merge 11840894](https://github.com/waitron-io/waitron-cloud/actions/runs/42036627987/job/127276526890) was not printed.
- The 90-second limit ([PR870](https://github.com/waitron-io/waitron-cloud/actions/runs/41387374274/job/125091183776),
  [PR942](https://github.com/waitron-io/waitron-cloud/actions/runs/41986274075/job/127107818923),
  [PR951](https://github.com/waitron-io/waitron-cloud/actions/runs/41996943278/job/127142507219)).
  Use the last `storage_admin_progress` record to separate reservation, startup, bucket,
  ownership and cleanup; startup's internal steps stay combined. Do not repeat the passing
  Linux concurrency probe without a new hypothesis or a fresh trace.
- Default native admin listeners outside the eight claims, admin-worker functionality, an
  actual admin bind refusal and other programs' bind races.

Keep the 101 listeners, the single restart, every owner and cleanup check, the 90-second case
limit and the 120-second wrapper.

## Storage test socket attribution and live progress (D575)

Reservation binds now report their phase, port and holder. Open: the refusal at
[PR932's root job](https://github.com/waitron-io/waitron-cloud/actions/runs/41897316384/job/126812884123)
(port 43549) and the held-bucket wrapper's 120-second limit on
[main 9b7c540a](https://github.com/waitron-io/waitron-cloud/actions/runs/41850829904/job/126652888279)
and [PR926](https://github.com/waitron-io/waitron-cloud/actions/runs/41882127691/job/126757174361).
A record survives `SIGTERM` but was lost after `SIGKILL`; GitHub job-timeout and
PostgreSQL-wrapper signals, and a closed stderr, are unqualified. Keep the allocation and
retry rules; use a new attributed recurrence rather than a broader claiming protocol.

## Admin owner probe draining (D581)

Both admin fixtures now drain probe bytes, which fixes a reproduced listener that could not
close after its peer disconnected. The [CI log](https://github.com/waitron-io/waitron-cloud/actions/runs/41986274075/job/127107818923)
has no accepted-socket data, so it cannot name the client or tie earlier timeouts to this
cause. A peer that stays connected can still delay shutdown.
