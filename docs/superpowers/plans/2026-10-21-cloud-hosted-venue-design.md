# Conditional delivery outline for Cloud-hosted venues

**D88 · 2026-10-21 · PROPOSED, not executable build authority.** Read the [design](../specs/2026-10-21-cloud-hosted-venue-design.md). No implementation, resource creation or spending starts before owner design approval. Approval of these documents alone does not accept a wire contract or authorise a live deployment.

The owner selected cold startup/restore only when needed, country-pack location
policy, full exit download with 90-day read-only backups, and approved-session or
strict emergency support with AWS key-service custody. The
[D101 design](../specs/2026-10-22-cloud-data-protection-design.md) and its D88
data-protection direction were approved on 2026-10-22 around 08:30 for build planning
only. The [D101 roadmap](2026-10-22-cloud-data-protection.md) records the reviewed
documentation milestone; implementation requires separate build authority. Its approved engineering choices
include a 24-hour maximum per venue support approval, fresh approval to extend,
conditional Paris `eu-west-3` backup and exit/retry/concurrency rules. O1 is answered.
Broader D88 hosting/isolation/shared contracts remain unapproved; legal/provider/runtime
proof and separate AI eligibility acceptance remain open. Do not reopen answered choices.
Keep reliability/promotion and package/pricing decisions after measurement; D103 owns
monitor/release/compute proposals. Daily/30-day and monthly/12-month snapshots have a
starting policy; reconcile the continuous hourly/30-day proposal with Waitron's actual
daily/seven-day configuration rather than reopening that snapshot choice.

The #265 access extension belongs to the **Cloud step soon after go-live**, not
go-live. It is a proposal publication before approval, not implementation-plan
approval. Do not start the conditional slices or provider work from this document.
The single [public access/A951 contract home](../../waitron-integration-contract.md#public-access-and-a951-proposed)
contains the functional surfaces, lifecycle and required acceptance matrix. A951 is
the named Waitron lasting-client dependency; obtain its accepted scope and landing
pin rather than assuming a client exists.

Before a boundary is built, Cloud and Waitron must accept the same versioned integration-contract revision with both source pins, named owners and acceptance cases. A947 is an unapproved counterpart, published as documentation at `490ece84c7e2e0f0185c0029d8c53a768e4f3fe2`; publication does not approve it, and later changes need reconciliation. A679 dormant-promotion preparation, W41s activation and W41s-10b fencing/witness work remain Waitron-owned prerequisites. A850's non-activating verifier and any `external-vault-archive-v2` use need actual landing and compatibility receipts. No Cloud fiscal allocation or activation authority is added.

Each numbered line sketches a conditional delivery boundary, not an executable implementation plan. Revalidate dependencies and write the build plan after full approval. Disabled adapters and documentation can land without enabling a customer service. Later slices remain blocked when a prerequisite is absent; no slice treats Kubernetes object deletion, route revocation or disk attachment as proof that an isolated old primary stopped.

1. **Joint contract agreement, documentation only.** After owner design approval and actual bilateral acceptance, record both pins, initial-setup identity binding, store/pointer versions and signatures/CAS, read-only follow, peer enumeration, accepted fencing evidence, activation receipt and uncertainty/retry vectors in Cloud's integration contract; Waitron maintains its canonical links independently. Gate: both owners accept the same revision, including the unresolved promotion preparation and external-vault boundary.
   Include the public access/A951 section: pin exact Waitron paths/assets and method
   families, normalization, host/tenant/session/token checks at gateway and application,
   cookie/CSRF/replay and mutation status/retry semantics. Gate: actual consumer
   acceptance, no public `/api` wildcard, and separately agreed payment-provider or
   webhook scope if offered. The functional table is not an existing endpoint list.
2. **Placement and isolation specification, documentation only.** After the D101 planning-only design approval, supplier/location qualification and separate security approval, name country/cell/cluster/zone boundaries, shared-host versus dedicated-machine choice, resource quotas, credentials and recovery reserve. Gate: a reviewed data-flow and failure map names every shared dependency and leaves unverified capacity unknown.
3. **Cost-model scope extension.** After slices 1–2, use the landed D68 public artifacts to add hosting and cold-recovery scenarios with separately unknown runtime, disk, keys, backup, traffic and fixed-floor inputs. Gate: representative measurements and dated price/billing assumptions; no extrapolated typical venue or complete EUR bill. D68 is landed, including follow-up `b8ff5555c996c5dec1086be49f7d046018bd3187`; its current inventory still excludes these services. A future running-follower cost scenario needs separate approval.
4. **Durable lifecycle journal, disabled.** After slice 1, add venue-scoped intents, input fingerprints, serialized claims, external-resource references and recorded uncertain outcomes. Gate: restart, duplicate-worker, lost-reply, stale-completion and cross-venue refusal evidence; uncertain activation cannot trigger another writer.
5. **Non-writing venue runtime adapter, disabled.** After slices 2 and 4 and compatibility agreement, package pinned Waitron images with persistent block storage and scoped worker authority. Gate: disk persistence, no business workers before activation, quota/neighbour isolation, management outage and cleanup restricted to owned resources; no live provisioning authorisation implied.
6. **Hosted backup and key adapter, disabled.** After slice 5, A850 and any required external-vault extension, connect direct streams, independent verified snapshots, versioned secrets and protected retention. Add the D101 country-pack boundaries, one extra EU backup copy, scoped KMS machine authority, approved-session/emergency human access, and exit download/read-only/purge lifecycle under the [D101 roadmap](2026-10-22-cloud-data-protection.md), after separate build authority and legal/contract qualification. Gate: lost original, missing stream, older-key restore, failed verification and cleanup interruption, all without fiscal activation; reconcile the continuous policy first.
7. **New venue Cloud-primary setup, disabled.** After slices 1, 4–6 and Waitron's no-predecessor bootstrap receipt, coordinate normal initial Waitron setup, verified activation outcome and staff/public routing. Gate: one venue/node binding under retries, no Cloud fiscal authority, no routing before confirmed activation and independent backup capture after setup.
8. **Planned handover adapter, disabled.** After Waitron's agreed fence/flush contract and slices 4–6, coordinate sales/filing stop, outstanding outcomes, final source position, target verification and activation. Gate: exact final state, concurrent requests and crashes around every boundary; unknown stop or activation remains blocked.
9. **Shared one-box recovery coordination, disabled.** After slices 6 and 8 plus Waitron's recovery/promotion acceptance, add recovery-point selection, explicit peer/stop checks, uncertain activation reconciliation and route cutover. The approved cold shape supplies an on-demand restored target. A running follower is outside the initial offering; slice 11 requires a separate future approval. Gate: actual recoverable time, absent source, uncertain stop, lost activation reply, confirmed receipt before stable-route cutover and returning-node refusal, first with controlled targets and then with the selected real target before enablement.
10. **Two-box Cloud recovery, disabled.** After slice 9 and landed A947 copy-up/follower contracts, admit the local-spare-to-Cloud path with separate uploaded/copied/applied positions. Gate: deletion-aware copy equivalence, both boxes enumerated and stopped, stale offsite data, competing local promotion and old-node return.
11. **Optional running Cloud follower, disabled.** Only after a separate future owner approval and slices 5–6 and 9 or 10, add scoped read-only following and freshness reporting. Gate: measured catch-up and restart costs, stopped follower before promotion, no sales/filing/device effects while following, and identical fencing checks to cold recovery.
12. **Cloud host replacement, disabled.** After slice 8 and provider-specific stop/restart-prevention acceptance, coordinate same-zone disk reuse or new-disk restore in another approved zone. Gate: isolated old host cannot write/file, unknown stop blocks, and provider capacity/restore evidence replaces assumptions; no cross-zone disk reattachment claim.
13. **Pinned upgrades, disabled.** After slices 6, 8 and 12 and Waitron schema compatibility rules, add staged stop/final-backup/migrate/verify operation handling. Gate: crash after migration, first write and new generation; rollback never restores an older ledger or resumes retired authority; pause and forward recovery work.
14. **Local device integration, disabled.** After Waitron print-agent and A764 payment-ownership agreement plus slice 7 or 9, connect the authenticated outbound device path. Gate: actual acknowledgement, persisted command identity, duplicate suppression, uncertain outcome, reconnect, stale-writer refusal and USB-host failure; no raw public device ports.
   Venue devices default to `.local` using Waitron local trust, without a Cloud redirect,
   WAN dependency or warning bypass. Qualify fresh offline LAN clients independently
   of any optional router override and selected certified staff path. A Cloud-only
   primary requires the certified path to its active server; do not manufacture a
   `.local` route or enable a local writer to mask WAN loss.
15. **Optional on-site follower, disabled.** Only after a separately approved offline-promotion design, accepted Cloud fence proof and Waitron return/tail receipts, expose this service shape. Gate: WAN partition with mobile-data/second-uplink clients, no concurrent writers, preserved tail and fresh dormant rejoin; no offline trading promise before proof.
16. **Launch qualification record, documentation only.** After the selected shape's slices (Cloud-primary: 1–8 and 12–14; one-box takeover adds 9; two-box adds 10; future separately approved running and on-site followers add 11 and 15 respectively), the D101 planning-only design approval, legal/exit/support/KMS qualification and owner reliability/pricing decisions, plus separately authorised provider rehearsals, record exact Cloud/Waitron/image/configuration pins, every failure-table result, resource/cost observations and launch-evidence checks. Gate: measured loss/recovery bounds, production credentials/transport/isolation, devices, monitoring, capacity reserve, exit and support proof; deployment and customer enablement require their own authority.
   Include slice 7a and its full shared acceptance matrix for the added public service.
   This qualification is for the later Cloud step; it does not expand go-live scope.

**Additional conditional slice 7a: public customer access and lasting appliance
integration, disabled.** After slice 1 and owner design approval, integrate live DNS/public certificate lifecycle, the joint customer route manifest
and authenticated, revision-bound peer configuration/acknowledgements. On-premises
targets require qualified A951 and use scoped WireGuard plus verified HTTPS. Hosted
targets use the isolated private cell path after slice 7 or 9 confirms activation,
with qualified endpoint configuration and certificate handling; an appliance client
is required only when an appliance path is offered. Staff keeps a different
hostname, endpoint private key and TLS passthrough. A951 supplies
connect/reconnect/reboot, rotation/move/revoke and v1 CSR polling, stale-result
checks and atomic install/reload; production use of the currently test-only v1
backend needs its own qualification. Gate: every case in the shared acceptance
matrix, including two venues, unavailable box with no offsite queue, lost mutation
reply without blind retry, QR/privacy and separate active/reachable/DNS/certificate
evidence. A tunnel alone is not readiness. This slice can qualify public access to
an existing active box without building hosted capacity.

Future feature and bugfix work follows repository TDD: observe the expected failing behavioural check, implement minimally, then verify the result. This outline supplies acceptance boundaries, not code, commands or a speculative endpoint specification. Preserve evidence about refusal and uncertainty as carefully as successful recovery; a restored database and a healthy pod are insufficient to enable a writer.

D101's approved design and published build plan are documentation only. They grant no authority to use parked
D79 (`fab41b1`) as landed verification or apply its migration 043. Preserve all existing
fiscal, activation, shared-contract, public/staff access, A951, isolation and cost gates.
No D101 control or supplier qualification is proved by this outline. Its planning-only
design approval does not approve the broader D88 build or enablement.
