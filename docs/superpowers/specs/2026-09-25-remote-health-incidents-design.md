# Remote health incidents design

## Outcome

Cloud persists the external HTTPS and staff TLS evidence emitted by the remote probe, rejects evidence for an obsolete route, and turns current evidence into durable route and certificate incidents. A route failure is independent from installation contact: a venue can keep checking in while one or both external routes are broken.

This change stops at durable operator evidence. Portal presentation and opt-in incident/recovery mail are D3, so the new incident kinds do not enter the email outbox yet.

## Ownership and data flow

`@waitron-cloud/remote-access` owns the probe result contract and a PostgreSQL evidence writer. The writer locks the installation row shared, then verifies the installation, venue, configuration revision, active placement and both hostnames still match the result. It records each public/staff result only while that authority is current. Placement replacement, hostname change and revocation all take the installation lock exclusively, so an old result either commits before the authority change or is rejected after it; it can never overwrite the replacement's evidence.

`@waitron-cloud/registration` owns the monitor and incidents. Its existing per-venue monitor lock serialises classification. For the active remote-access route it reads only observations matching the current installation, revision and hostname. A fresh failed observation opens the service's route-failure incident. Missing or old evidence is unknown and opens the service's probe-stale incident after the configured freshness window; it cannot leave a prior success healthy. A fresh healthy observation recovers both states. Removed, superseded, unconfigured or revoked routes suppress their route and certificate incidents.

## Persistent evidence

Migration `017_remote_probe_observations.sql` adds one row per installation and service (`public` or `staff`). Each row stores current status, checked time, elapsed time and redacted failure classification; last-success and last-failure times; and the most recently verified certificate validity and SHA-256 fingerprint. A newer result updates the row. Equal or older results are idempotent no-ops. Failures preserve the last verified certificate evidence while updating current failure evidence.

The existing incident table accepts six new kinds: public/staff route failure, public/staff stale probe, and public/staff expiring certificate. An expiring-certificate incident includes both the warning and expired cases; the stored `not_after` timestamp distinguishes them without creating a noisy second transition at the expiry instant.

## Configuration and bounds

The monitor accepts two positive integer thresholds: probe freshness in seconds (default 300) and certificate warning in days (default 30). The CLI reads `CLOUD_REMOTE_PROBE_STALE_SECONDS` and `CLOUD_REMOTE_CERTIFICATE_WARNING_DAYS`, rejects malformed values and keeps the defaults when unset.

The probe runner remains bounded to 100 targets and four workers. Its result callback becomes awaitable. The CLI waits for each evidence write, and a database failure ends that bounded run with the existing redacted error rather than printing or silently losing the result.

## Verification

Real PostgreSQL tests cover success/failure history, older-result rejection, process restart, concurrent writers, hostname/revision replacement and revocation races. Monitor tests cover fresh failure and recovery, stale/unknown evidence, certificate warning and expiry boundaries, suppression, concurrent monitor workers, and continued installation contact during route failure. Existing snapshot/contact tests stay unchanged.

Documentation states the defaults, environment variables, evidence semantics and the fact that notifications remain pending D3. The Service monitoring backlog entry is narrowed to the remaining portal/notification, retention, scaling and rollout work.
