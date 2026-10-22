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
| P3 | **Separate the global layer from the country** | The account database split along spec section 4's line; country services trusting a global sign-in through a signed token they check without calling the global layer; each side deployable alone in P1's rehearsal. | the Cloud repository's migration slot (the backlog: "No further migration item starts until its slot resolves", the slot being migration 043's) |
| P4 | **The action list and Cloud's controller** | The list of automatic actions in code, each "ask first" or "act and report"; asking through the console and a notification; the recorded change that moves an action; the incident write-up step in `incident-response.md`. | P1 |
| P5 | **Release waves** | Releases applied cell by cell from the repository in waves that stop by themselves when health fails; on launch day the owner widens each wave (spec section 6); self-widening waves as the first automation after launch. | P1, P4 |
| P6 | **Hosted venues** | Per-venue disks, the gVisor sandbox, placement by busy hours, quiet-hour moves, and the stop proof before any new writer (spec section 9). | P1, P4, the owner's security approval of the sandbox, and the stop-proof contract agreed with Waitron |
| P7 | **Failover and the outside monitor** | Spain rebuilt in Paris from P2's files with keys and the management database usable there, rehearsed as a drill; the amended D101 rule; the outside monitor at a second EU provider. | P2, P3, the lawyer question on Paris |

P1 and P2 can start now. P3 starts when the migration slot frees, so P4 and P5 run beside it.
P6 is the longest wait because of its two outside dependencies; asking Waitron for the stop
proof's contract early keeps it off the critical path.

## Who builds it

Cloud's campaign lanes build this repository. Each plan is a queue item: plan, plan review,
build in tasks, then `/finish-branch`. P1 and P2 are independent and can go to two lanes.
