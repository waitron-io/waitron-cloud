# Automatic remote access on the test Cloud

Pair a Connected test venue, including one on its free Connected trial, and open its assigned Staff address on mobile data without another setup step. Keep the box switch. Custom domains remain an owner choice. Source is Lane K's OWNER-REMOTE-ACCESS-AUTOMATIC item, the owner trial report on 18 November at 20:39, and the watcher's 23:08 eligibility decision.

## Cloud change

1. In `deploy/test-cloud/runtime.mjs` pass the configured gateway cell ID to the account process in test venue-level mode. The Amazon account already selects this mode in `compose.amazon.yaml`. In `account-worker.mjs` supply `{mode:'automatic',cellId}` to `startAccountServer`. Keep the pinned one-box variant in `packages/account-http/src/tunnel-provision.ts`. In automatic mode use the signed installation ID throughout, retaining test environment, current proof and lease checks, rate limits, Connected eligibility and the existing cell and port 443. The cell can accept requests after the manifest worker creates it. The existing workers publish names, certificates and routes.
2. In `packages/remote-access/src/placement.ts`, automatic retries respect an operator-off setup whose configuration still holds the matching peer key. A billing lapse clears the active installation's configuration. With eligibility restored, the same key can restore that cleared setup. Use the existing locks and keep explicit enable and the pinned route's behavior.
3. In `packages/account-http/src/remote-access.ts`, expose optional `connectedRequired:true` in the owner status for Registered test venues. The existing portal panel in `remote-screen.ts`, `remote-types.ts` and `locale.ts` explains in English and Spanish that remote access comes with Connected. Eligible owners see setup in progress until the assigned address appears. The panel remains where they manage custom names.

## Checks and size

- Extend `packages/account-http/test/tunnel-provision.test.ts` with its signing fixture and the Connected setup from `packages/registration/test/fixtures/venue-service.ts`. Check separate eligible assignments, concurrent same-key retries, Registered refusal, off surviving retry, and lapse then regrant. Keep the pinned security checks.
- Extend `deploy/test-cloud/runtime.test.mjs` for account-only cell wiring. Keep the withdrawal and explicit enable coverage in `remote-controls.test.mjs`. Check the Registered status with `packages/account-http/test/venue-service-remote.test.ts` and its message with `apps/portal/test/remote-refusal-guidance-browser.test.ts`. Run the named tests before and after their changes, then typecheck and inspect both languages at the required widths and themes.
- Update `docs/test-cloud.md`, the tunnel section of `docs/waitron-integration-contract.md` and the LAN test Cloud backlog entry. Document that one cell can assign 64 test venues. Estimate 100–140 implementation lines, 150–220 test lines and 30–45 documentation lines.

## Joint trial

Lane J owns the companion image, startup and private listener in BOX-REMOTE-ACCESS-AUTOMATIC. Lane K's `receipts/test-cloud-custom-domain/owner-trial-manual-steps.md` shows that the current owner trial placement already uses the companion-generated key. Preserve that venue and key. Agree a fresh, already Connected test pairing on the actual pre-production box with Lane J. Open the assigned address on mobile data, turn off access on the box and verify it stops. The feature remains open until the joint trial.
