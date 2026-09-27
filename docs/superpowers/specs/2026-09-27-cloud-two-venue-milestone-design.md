# Complete two-venue Cloud milestone

## Outcome

One local command proves the first Cloud milestone with two disposable real Waitron
venues. It pairs both venues through manager and Cloud-owner approval, reaches both
through one real WireGuard/HAProxy gateway, protects the public route, verifies staff
TLS passthrough, captures backups before and after replacing that gateway, restores
one venue from continuous data and the other from a retained snapshot after its
continuous data is removed, and gives a recovered server fresh Cloud authority.

The command emits one versioned JSON receipt. It records the exact Cloud and Waitron
commits, whether either checkout was dirty, the component evidence, and measured
gateway, cell-move, continuous-restore, snapshot-restore and replacement times. These
are local observations, not production availability promises.

## Composition boundary

Reuse the three landed proof components instead of creating new product machinery:

- the remote proof owns pairing, staff/public TLS, bot protection, route isolation,
  gateway replacement and cell movement;
- the transfer proof owns bounded uploads/downloads, interrupted transfers, durable
  retries and orderly cancellation;
- the managed-backup proof owns stream observation, continuous cold restore,
  retained-snapshot fallback and owner-confirmed server replacement.

A top-level proof command starts one PostgreSQL/Mailpit fixture, then its runner executes
these components and validates each receipt before publishing the milestone receipt. Each
component may use its own disposable PostgreSQL schema and Waitron state directories. The receipt calls
them phases, not one persistent production deployment, and never equates their random
installation identifiers.

## Backup continuity through gateway replacement

The remote phase must establish the cross-component assertion itself. Start its two
Waitron fixtures with the existing backup state, provision separate local object-store
locations, and capture one encrypted, installation-authenticated snapshot per venue.
Replace the actual gateway container, wait for both stable hostnames and certificate
fingerprints to recover, then capture another snapshot per venue.

Stop each Waitron process while its standalone capture fixture reads SQLite, then
restart it on the persisted port before continuing remote checks. Both before/after
sets must contain two distinct catalogue points bound to the expected installation and
venue. A point or object from one venue must never satisfy the other venue's check.
This demonstrates that direct backup publication continues across a gateway
replacement while the remote routes remain separated; it does not claim backups
traverse the gateway.

## Recovery and replacement evidence

The managed-backup receipt moves to version 2 and records measured elapsed time for
the successful continuous retry and snapshot fallback. It also records the old and
new installation identifiers, that they share the venue, that the old authority was
refused, that the new authority used a different recovery key, that routing kept the
same customer-facing address and names, and that the replacement published and
restored a fresh snapshot. Activation stays explicitly `not-performed`.

The milestone verifier accepts only exact receipt shapes. It rejects dirty release
evidence, mismatched component commits, absent real-Waitron/provider/gateway checks,
missing before/after backup points, crossed venue bindings, non-finite timings,
unretired old authority, reused replacement secrets, changed public names, missing
fallback evidence or any activation claim.

## Failure handling and cleanup

Every child runner retains its existing timeouts and owns all temporary files,
containers, processes and database schemas. The top-level runner creates private
temporary receipt paths, forwards child output, stops immediately on the first failed
phase, and removes its temporary directory in `finally`. A failed run never writes the
requested final receipt.

The proof uses only local Pebble, SeaweedFS, PostgreSQL, Mailpit and Docker fixtures.
It creates no AWS, Google, DNS, email or customer resources and does not deploy or
activate a recovered venue.

## Documentation and remaining gates

Update the milestone backlog and local backup/remote guides with the one-command proof
and its limits. Retain the production gates: provider contract tests and deployment,
real DNS/ACME and secret custody, appliance automation, planned final-write handover,
explicit activation and fencing, capacity targets, monitoring destinations and live
database recovery.
