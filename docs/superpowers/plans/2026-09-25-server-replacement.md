# Server replacement implementation plan

> Implement using superpowers:executing-plans; delegate only the independently owned Waitron adapter once the wire contract is fixed.

**Goal:** Reconnect a restored test server to its existing Cloud venue with owner approval and fresh credentials.
**Architecture:** Extend managed recovery with a signed replacement proposal and transactional Cloud handover. Waitron imports the durable result into its existing connection gate. Keep local activation rules intact.
**Tech stack:** TypeScript, PostgreSQL, Hono, Lit, pnpm; real local Waitron SQLite and HTTPS storage fixtures.
**Spec:** ../specs/2026-09-25-server-replacement-design.md

## Constraints and review focus

- Local test snapshots only; no live provider resources, production or automated promotion.
- Preserve venue, backup history and hostnames; fresh keys and unknown service observations.
- Lost replies/crashes preserve request identity and permit exact replay; changed bindings refuse.
- Recheck session/manager/primary/expiry after waits; prove competing operations with independent connections.
- Exclude every new private state file from archives and browser views.
- Normal signed commits, hooks, isolated review and current-head CI; retain review across patch-equivalent rebases.

## 1. Cloud handover and consumers

Files: registration migration016, migrate/startup guards, registration/index.ts and installations.ts, account-http/venue-overview.ts, monitoring consumers; backups/replacement.ts with real database tests.

- [ ] Add tests expecting one current installation with retained old history, exact retries and old access refusal; run them red before implementing.
- [ ] Add supersession history and replacement proposal/result persistence. Update every uniqueness/query consumer while preserving refusal of unrelated ordinary pairing.
- [ ] Implement signed prepare/status and owner completion with atomic service/resource handover and key rotation. Use the exact protocol in the spec.
- [ ] Test permission/expiry contention, wrong proofs, conflicting replacement, cancelled recovery, active result retrieval, old grant races and retained snapshots. Run focused migration and package tests; commit with sign-off.

## 2. HTTP and owner screen

Files: account-http/replacement.ts, app.ts, recovery.ts; portal recovery types/controller/screen/locale/API; corresponding HTTP/controller/browser tests.

- [ ] Write failing endpoint and owner-screen tests for prepare -> inspect -> explicit replace -> status.
- [ ] Add origin/CSRF/body/IP/key limits and fixed public errors. Show replacement proposal through recovery inspection.
- [ ] Add bilingual confirmation bound to current old installation, account and request; do not replay an uncertain write automatically.
- [ ] Verify lost replies, owner loss, concurrent clicks, expiry and375px light/dark axe/rendering; commit.

## 3. Waitron companion

Files: server cloud-replacement.ts/test, cloud-client.ts/test, cloud-api.ts/test, boot.ts/tests; dashboard Cloud screen/client/tests; recovery fixture and developer/backlog docs.

- [ ] Start from completed managed restore; persist fresh installation/peer keys before outbound requests. Test lost replies/restarts, invalid responses and source binding first.
- [ ] Add existing local manager and serving-primary gates, before/after waits. Import completed registration through shared connection write gate with exact retry checks.
- [ ] Expose request/check reconnection in Cloud settings, with private state excluded and synchronous busy handling.
- [ ] Test gate deletion, state-copy exclusion and local UI behavior; run focused types/coverage where needed, signed commits.

## 4. Real integration and landing

Files: scripts/test-local-backups.mjs, local-backups.md, waitron-integration-contract.md, both backlogs.

- [ ] Extend existing proof: actual cold restore -> local replacement proposal -> owner HTTP confirmation with lost reply -> restarted client import -> lease/renewed new capture; old key refusal, stable hostnames and unrelated venue unchanged.
- [ ] Update docs/backlogs, including precise remaining certificate installation and activation boundaries.
- [ ] Review each complete production branch in installed independent temporary clone, triage with executable receipts, fix with TDD.
- [ ] Run final clean integration, normal push gates, current-head CI. Land normally, refresh main dependencies and remove feature worktrees/branches. Report results.
