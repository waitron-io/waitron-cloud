# Production deployment: the build, in seven plans

**Spec:** [production deployment design](../specs/2026-10-22-cloud-production-deployment-design.md),
approved by the owner on 2026-10-22 for building and rehearsing locally. Opening AWS accounts,
spending money and production schema changes need a separate go-ahead (spec section 12).

The design covers seven systems that can each be built and tested on their own, so each gets
its own detailed, task-by-task plan, written when its turn comes. This file fixes their order,
what each delivers, and what each waits on. Every detailed plan follows the repository's rules:
test first, tasks one implementer can finish in well under about 100 tool calls, and a
fresh-context review of the plan against the spec before any implementer starts.

## Order

| # | Plan | Delivers, rehearsed locally | Waits on |
| --- | --- | --- | --- |
| P1 | **A country cell on Kubernetes** | Cloud's existing services (account API, portal, registration and backup workers, remote-access gateway, monitor), today run by `compose.yaml`, packaged as images with Kubernetes manifests and deployed from the repository by a tool in the cluster (Argo CD or Flux) onto a local Kubernetes cluster. A test venue pairs, reaches remote access and backs up through it; killing one of the three local machines takes none of the three down. | nothing |
| P2 | **[The AWS layer in OpenTofu](2026-10-22-cloud-aws-layer.md)** | Accounts per country and for the global layer, a network across three data centres, one EKS cluster per cell, outbound gateways per data centre, keys (KMS), buckets, and the `waitron.io` / `es.waitron.io` DNS zones, written in OpenTofu and checked with `tofu test` against mocked providers. Never applied: applying is the owner's separate go-ahead. | Agree P1's integration handoff; provider-only mocked plans can proceed before its images and manifests exist. |
| P3 | **[Independent countries and a small worldwide admin console](2026-10-22-cloud-global-country-split.md)** | Spain configuration and foreign-business signup refusal; a small worldwide console with its own admin passkey sign-in, health/deploy starts, apex DNS and redirect. Reuse/shrink P2 global; no country data copies or country operator authority. | Docs first, before D113’s fresh plan read. The console implementation needs its own plan to reuse/shrink P2; no old P3 migration/cutover gate. |
| P4 | **The action list and Cloud's controller** | The list of automatic actions in code, each "ask first" or "act and report"; asking through the console and a notification; the recorded change that moves an action; the incident write-up step in `incident-response.md`. | P1 and P4’s own plan/build gates; one configured operator account in Spain with explicit country permissions, independent of worldwide sign-in. |
| P5 | **Release waves** | Releases applied cell by cell from the repository in waves that stop by themselves when health fails; on launch day the owner widens each wave (spec section 6); self-widening waves as the first automation after launch. | P1, P4 |
| P6 | **Hosted venues (D115, carrying D88 runtime/build delivery)** | One gVisor-isolated runtime and disk per venue on shared machines in country cells, placement by busy hours, quiet-hour moves, cold recovery and controlled/emergency handover (spec section 9). | P1/P4, existing country owner checks and D608’s one-owner rule/swap-owner function; A1018 design approved 2026-10-24, jointly accepted formats/compatible A947 amendments and separate A1018 build authority before affected adapters; runtime qualification before enablement. gVisor approved 2026-10-23; A951/D101/P7 keep their affected-path gates. |
| P7 | **Failover and the outside monitor** | Spain rebuilt in Paris from P2's files with keys and the management database usable there, rehearsed as a drill; the amended D101 rule; the outside monitor at a second EU provider. Country rebuild grants no venue activation: use an explicit section 9 scenario or separately selected cold restore. | P2, self-contained country recovery, legal/provider qualification and the venue protocol for any venue recovery; running Spain from Paris approved 2026-10-23 |

P1 and P2 retain their existing local authority. D112-S replaces P3's former
migration/global-operator programme: documentation first, then D113's fresh P4
plan read and D608's handover slices 12–13, then the country signup guard and
separately planned worldwide console. P4/P5 retain their own plan and dependency
gates. Any actual migration still needs its available slot; P3 adds no country
database cutover or worldwide authority handoff. P7 recovers each country's own
database and keys in its own second region, without P3 permits.
P6's revised [joint handover direction](../../waitron-integration-contract.md#handover-between-local-and-hosted-machines-a1018)
is agreed by Cloud, replacing #300's rejected stop-proof direction. The owner
approved both Harbour Kitchen examples and retained defaults on 2026-10-24 at
04:07, recorded in [Waitron
`060966c2b3e9203acf0849042814997307cae463`](https://github.com/clintongormley/waitron/blob/060966c2b3e9203acf0849042814997307cae463/docs/superpowers/specs/2026-10-23-a1018-simple-handover-design.md).
This supersedes pending-question wording at historical source pins. After either takeover M2 alone handles
AEAT, filing copied and returned old originals in their generating identities; M1
transfers missing originals, all received outcomes and uncertainties without AEAT
contact. No emergency predecessor ownership hold blocks M2; temporary per-chain
apply pauses and unresolved filing-case holds remain. Detailed wire formats, build
authority, compatible A947 amendments and runtime checks remain pending. P7 never treats a regional outage as a venue emergency declaration.

**D88 reconciliation, 2026-10-24:** close the duplicate design-approval gate;
no D88 owner question is ready to ask now. The production approval already supplies
local build/rehearsal authority within scope. P6/D115 owns the detailed hosted
plan and implementation; this order adds no provider or activation authority.
P1 packaging, existing country owner checks/D608, P4 action permissions, A951
access, D101 data controls and P7 recovery remain distinct dependencies.
P5 governs per-cell releases.
Reliability promises and pricing await measurements as later launch decisions.

D112-S keeps each country independent: billing, customer email, logs/alarms,
keys, secrets, backups and a second region stay in-country. The email provider
is unchosen. Worldwide keeps the apex and Spain redirect; its database is for console
admins only. The console plan chooses how to handle its own security, health
and deployment state, without country data copies. P2's current global customer runtime still needs shrinking; these
docs do not change it. Country operators sign in locally; worldwide sign-in
confers no P4 authority. Releases come from the reviewed repository, started
from the admin console and pulled by each country. Nothing passes between
countries. D608 owns the one-owner database rule and swap-owner function within
handover, without support takeover or operator/fiscal authority.

## Who builds it

Cloud's campaign lanes build this repository. Each plan is a queue item: plan, plan review,
build in tasks, then `/finish-branch`. P1 and P2 are independent and can go to two lanes.
