# D621 run 9 PR 12 | Stop each Stockholm machine in turn

Keep the same outside venue, account session, tunnel and backup data through three separate
15-minute stops. Reuse the outside baseline, the existing observer and the three-node database
and store checks. [Run 9 decision](2026-11-18-d621-run9-qualification.md) ·
[Sizing row 12](2026-11-18-d621-run9-sizing.md) ·
[P1 acceptance table](2026-10-22-cloud-country-cell.md#acceptance-and-boundaries)

**12a | Make the outside journey independent of machine A.** Run the service pod as a
DaemonSet so each machine hosts a restarting copy with the same keys and its own authenticated
Mailpit. Run inspections in a surviving copy and read all surviving inboxes over kubectl.
Extend the private relay with separate account and S3 TLS listeners and health checks. Admit
TCP 3000 on each machine from the rehearsal peer only. Use the existing S3 service DNS name,
certificate and port 9000 inside the cell. Resolve that name to the relay in the outside venue
and forward to the existing per-node S3 port. Keep the installed verifier image and bounded
scratch ready on each node. Use a surviving machine for Kubernetes commands and image import.
Verify the same account session, new mail and retained object after stopping each machine in
the existing private Kind journey. Keep the no-stop baseline mode.

Change `deploy/kubernetes/{services,remote-relay}.mjs`, `deploy/kubernetes/bounded-amazon/bootstrap.sh`
and `scripts/{kubernetes-services,kubernetes-outside,kubernetes-check,kubernetes-remote,amazon-run,test-cloud-integration}.mjs`.
`services.test.mjs` owns placement, `bootstrap.test.mjs` owns the firewall,
`kubernetes-remote.test.mjs` owns the relay arguments and survivor selection, and
`kubernetes-services.test.mjs` owns mail, image import and the opt-in journey.
Estimate 280–385 implementation and 155–225 test lines.

**12b | Prove complete service recovery.** In `amazon-run.mjs` and `kubernetes-node-loss.mjs`,
confirm each exact node is off before marking it out of service in Kubernetes. Restart the same
machine, restore its private peer route and remove that mark. Drop A's staging mount on B and C
before stopping A. Require healthy services, one writable primary and healed storage before the
next leg. Inventory roles before each stop and arrange coverage of the database primary, active
gateway, database operator and Flux. In `scripts/test-cloud-integration.mjs` and
`deploy/test-cloud/test-fixtures/integration-paid-remote.mjs`, retain the venue and reuse `observeP1`. Keep the 90-second account and HTTPS, 300-second backup
and 180-second Git bounds, and record probe gaps. Replace a stranded login challenge within the
existing mail-claim time and rate budgets. Require new real work from email, publication and
backup after the primary moves, and record when it finishes and which process did it. Keep the
original certificate and public body checks through any browser challenge. In `kubernetes-git.mjs`
expose the existing revision and drift checks on surviving nodes. Fail the run on a missing leg,
role, worker result, retained-state check or cleanup. Replace run 8's two C-only modes on the
local pass.

`amazon-run.test.mjs` owns scoped stop/start, refusal of a shortened hold and the 150-minute
budget including PR 13 and deletion. `kubernetes-node-loss.test.mjs` owns Kind stop confirmation,
`kubernetes-git.test.mjs` owns survivor Git repair, `p1-observer.test.mjs` owns bounds and omitted
evidence, and `test-cloud-integration.test.mjs` owns retained clients and probe wiring. Extend the
12a Kind journey with three 6-minute holds. Budget 9 minutes for the baseline and 24 for other
setup, healing and cleanup, leaving 4 minutes in the 55-minute guest. Require all bounded recovery and worker
evidence while the machine is off. Keep the full 15-minute Stockholm holds. Run the named tests
and typecheck. Update the AWS guide, sizing and backlog. Estimate 330–455 implementation
and 210–285 test lines.

The split replaces row 12's 260–380 / 160–240 estimate because both outside service addresses,
commands and the verifier currently depend on A. The certificate HTTP 500 and unexplained
backup worker exit remain open. PR 13, the full timed dry run, billing and the separate Amazon
approval conditions still apply.
