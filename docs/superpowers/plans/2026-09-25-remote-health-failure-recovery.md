# Remote Health Failure and Recovery Proof Plan

**Goal:** Prove that the local two-venue gateway, external probes, durable monitor, portal evidence and encrypted alert delivery agree through route and gateway failures.

**Architecture:** Extend `scripts/test-local-remote.mjs`, which already owns the real Waitron servers, WireGuard peers, HAProxy gateway, local ACME authority, PostgreSQL portal fixture and Mailpit. Persist the real probe results through `RemoteProbeObservationStore`, run the existing `MonitorWorker`, and inspect the owner-scoped account API and delivered mail. Keep failure injection inside the proof and add no production bypass or second monitoring path.

**Constraints:** Use local fixtures only. Keep installation control contact fresh during route failures. Do not expose raw probe errors or secrets. Do not edit Waitron. Preserve the existing gateway, revocation, bot-challenge, staff-isolation and LAN-independence assertions.

## Task 1: Define a discriminating receipt gate

- Add a receipt verifier that requires the route outage, stale worker, invalid trust, gateway outage, recovery, isolation, certificate warning and alert-deduplication phases.
- Run it against the current proof receipt shape and observe the expected failure before extending the proof.
- Keep the verifier independent of implementation details: it checks versioned phase names, measured non-negative timings and bounded counts.

## Task 2: Compose the landed monitoring path

- Reuse the existing configured placements and exact fixture resolver.
- Opt the real owner into service alerts through the account HTTP endpoint.
- Record actual healthy probe output, schedule both venue monitors and establish a baseline with no route-failure or stale-probe incident while installation contact remains fresh.
- Add small proof-local helpers for probing, recording, forcing due checks, reading redacted account evidence and counting Mailpit messages.

## Task 3: Exercise failure and recovery phases

- Stop only venue A's WireGuard peer; record real failed public/staff probes for A and healthy results for B; assert A incidents, B isolation, owner-scoped portal evidence, opening delivery and deduplication.
- Restart the peer; record real recovery, assert both routes healthy and deliver recovery once.
- Let evidence exceed a short proof-only stale threshold while control contact remains fresh; assert unknown/stale state without a false route-failure transition, then restore fresh evidence.
- Probe the real gateway with the wrong trust root and assert fixed TLS failures without raw diagnostic leakage.
- Stop the gateway, record real failed probes for both venues, then replace it with the same signed manifest and assert recovery, stable hostnames/certificates, portal state and alert transitions. Measure the unchanged mature peer's normal WireGuard rekey rather than assuming the earlier fresh-peer time.
- Treat the real local ACME certificate as warning-eligible with a proof-only configured threshold and assert its recorded expiry evidence.

## Task 4: Receipt, docs and focused verification

- Emit a schema-versioned monitoring receipt with phase timings, incident/delivery counts and per-venue isolation evidence.
- Update `docs/local-monitoring.md`, `docs/local-remote-access.md` and the Service monitoring backlog entry with the runnable command, measured scope and limits.
- Run the real proof, the receipt verifier, focused remote-access/registration/account tests, affected typechecks and `git diff --check`.
- Mutate the receipt's isolation and duplicate-delivery evidence and show the proof gate fails for each negative control.
- Commit with sign-off, then run the authorised finish/land workflow and verify current-head and exact-merge CI.
