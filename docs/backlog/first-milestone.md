# First working milestone

The [combined local receipt](../launch-evidence.md#read-the-local-evidence-narrowly) verifies these
steps with two test venues, as local measurements and not service objectives. Repeat them against
the selected deployment before treating the milestone as launch evidence:

1. Connect a venue through owner approval, assigned names and venue-scoped credentials.
2. Prove public cloud inspection and staff TLS passthrough, including isolation between
   venues and protection of staff functions from public routes.
3. Upload backups directly to object storage and show the latest recoverable time.
4. Restore onto a replacement from the continuous backup and from a retained snapshot,
   including with continuous data absent. Cover planned hardware replacement and
   recovery after failure through the agreed shared flow.
5. Replace the gateway, measure reconnection time with unchanged customer-facing
   addresses and verify that backups continue.

The [integration contract](../waitron-integration-contract.md) maps the operations and the
[venue pairing design](../superpowers/specs/2026-09-23-venue-pairing-design.md) the wire contract;
the [registration plan](../registration-implementation-plan.md) sequenced the work. Pairing remains a
separate exchange requiring both Cloud and local administrator proof.

**Open:** live mail delivery, provider DNS and certificates, production ingress, deployment and
secret custody, provider-native management-database recovery, planned final-write handover,
automatic tunnel and certificate installation, activation, country partitioning, database
availability and per-cell storage. Existing services must tolerate a management outage within the
scoped credential and revocation rules of the
[installation lifecycle spec](../superpowers/specs/2026-09-24-installation-lifecycle-design.md). Public
deployment is gated by the [service-adapter and ingress work](../backlog.md#platform-work-to-scope).
