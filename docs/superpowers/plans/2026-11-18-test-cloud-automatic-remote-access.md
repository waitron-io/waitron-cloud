# Automatic remote access on the test Cloud

After pairing, the owner can open the venue's assigned Waitron address from a phone on mobile data. Setting up a custom domain is a separate action. The box keeps its remote access switch. Source is Lane K's OWNER-REMOTE-ACCESS-AUTOMATIC item and the owner trial report on 18 November at 20:39.

## Cloud change

1. Enable the existing signed `/api/installations/tunnel-provision` request through a private test Cloud setting. Pass the setting through `deploy/test-cloud/compose.yaml` and `runtime.mjs`. In `account-worker.mjs`, use the configured gateway cell ID and supply `{mode:'automatic',cellId}` to `startAccountServer` only with test venue levels. Keep the pinned one-box option in `packages/account-http/src/tunnel-provision.ts`. The signed installation identifies the box. Cloud selects the cell and port 443. Keep current proof, lease, eligibility and rate checks. The existing workers publish names, certificates and routes.
2. In `packages/remote-access/src/placement.ts`, give automatic provisioning a first-setup-only option. Under the existing locks, a same-key retry returns the current setup. If the Cloud switch cleared setup, the retry leaves it off, including after a lost reply. Explicit operator enable can still restore the placement. Preserve the existing lock order and post-wait identity checks.

## Checks and size

- In `packages/account-http/test/tunnel-provision.test.ts`, use the existing signing and PostgreSQL fixtures. Prove two eligible test boxes get separate assignments, concurrent retries allocate once, and a retry after off preserves setup and revision. Check that a Registered venue and an out-of-scope proof cannot allocate. Keep the pinned trial checks.
- In `deploy/test-cloud/runtime.test.mjs`, check that only the opted-in account process gets the configured cell. In `deploy/test-cloud/remote-controls.test.mjs`, reuse the existing withdrawal and explicit re-enable fixture to prove the route follows the switch. Run the named files through `scripts/test-postgres.mjs`, with each new behaviour failing before its fix, then run `pnpm typecheck`.
- Update `docs/test-cloud.md`, `docs/test-cloud-service-controls.md`, the tunnel section of `docs/waitron-integration-contract.md` and the LAN test Cloud backlog entry. Estimate 80–120 implementation lines, 130–200 test lines and 30–45 documentation lines. Scope is assigned addresses and test deployments.

## Before the phone trial

The watcher needs to settle eligibility for a fresh Registered venue. The 20:45 trial note cleared one manually started Connected trial. Keep the existing eligibility check while that decision is open. With pre-existing Connected eligibility, Cloud can prove its part using a synthetic venue.

A Waitron lane needs to ship and start the existing tunnel companion and wire its private listener. Once both sides are deployed to the approved test setup, pair a box, then open its assigned address on mobile data without any further setup. Turn remote access off on the box and confirm the address stops working. Preserve the owner's existing box and venue while arranging that rehearsal.
