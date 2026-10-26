# Venue and node registration

The agreed Waitron signup and connection journey is
implemented locally. The Cloud account backend creates a new customer's organisation
and first legal business. Signed matching-code pairing requires current Cloud approval
to add venues and current local administrator approval, supports one person holding both
permissions, enforces one organisation per venue, and handles existing links, renewable
installation credentials, replacement and revocation.
Keep venue identity stable across replacement and issue fresh installation credentials.
Test that restoring data alone does not grant primary authority and that a returning
old server follows Waitron's recovery rules. Cloud revocation alone does not establish
that an offline server has stopped trading.
The shared replacement flow for planned upgrades and failure recovery is implemented
locally. Add the final-backup handover after stopping writes during a planned move.
Failure recovery already shows the selected snapshot time or continuous recovery
point and potential data loss. Approval requires confirmation that the old server
is unavailable and acceptance of data loss; replacement separately requires explicit
confirmation. PostgreSQL and HTTP refusal tests cover the server-side checks in
`packages/backups/test/recovery-request.test.ts` and `replacement.test.ts`.
These confirmations do not prove an offline server has stopped trading. Preserve
Waitron's recovery rules; production activation and route-switch interruption
checks remain open.
Registration persistence now records bound approvals and results with transactional
completion, expiry, retries, permission rechecks and separate service states. Real
PostgreSQL tests cover concurrent workers and process restart. The Cloud pairing verifier and HTTP exchange now bind Ed25519 installation proof,
matching code and session-backed approval, with durable guess limits and retries.
The Waitron adapter and both browser screens now connect two real SQLite installations
in the local integration runner. Renewable signed control leases and key proofs now
authenticate machine operations; owner or local-manager revocation records its actor,
reason and result. Desired revisions and stale health remain separate. Scoped storage/gateway adapters and owner-confirmed test-snapshot replacement are implemented locally; production rollout remains open. The owner approved matching-code confirmation between
signed-in local Waitron and Cloud. The [pairing contract](../superpowers/specs/2026-09-23-venue-pairing-design.md) fixes
proof format, expiry, attempt limits and binding. Local tests refuse swapped installation
proofs and recheck manager permission and serving-primary status after network waits. Installation history now retains superseded rows with one current installation per venue. Replacement binds the restored local venue and source node to the approved snapshot, uses fresh keys and has separate local-manager and Cloud-owner confirmation. Ordinary pairing refuses an unrelated installation, including a revoked current one. Expand diagnostics and planned-handover support before production rollout.
Before public exposure, choose exact retention cutoffs for installation operation
results and pairing requests, and define revocation-audit retention separately.
The cleanup command handles completed/expired pairing and registration results in
bounded chunks but enables no category automatically. Pairing approvals, credential
renewals and revocations now have immutable customer audit events. Installation lease
consumers now accept an operator-configured overlap of old and new issuer public keys,
while new leases use only the active private key. The local control-plane outage drill
proves overlap, cutover, expiry-before-removal and revoked-lease refusal without logging
keys. Choose audit retention, rehearse the coordinated rotation in the selected deployment,
and measure per-IP denial-of-service behavior
for venues sharing NAT and known request IDs. Pairing codes now use versioned, request-bound keyed verifiers with an external
secret and an explicit legacy upgrade; see [key configuration and rotation](../pairing-code-keys.md).
PostgreSQL/HTTP tests cover preserved approvals/history, restart, expiry, concurrent
guesses, request binding and key overlap/refusal. Local business confirmation stays
required. Old backups remain sensitive; no new retention policy is chosen.
Backup-recovery request codes now have their own independently configured,
request/machine-bound keyed verifier and explicit legacy upgrade; see
[recovery key configuration and rotation](../recovery-code-keys.md). PostgreSQL/HTTP
tests cover storage, cross-request reuse, machine retry/status, owner approval,
five concurrent-guess limits, expiry, process restart, rotation, absent/wrong keys
and preserved pending/completed history. Upgrade rollback, bounded batches and
row-lock waits and the actual CLI lock timeout are exercised; HTTP/CLI/audit
checks disclose no code or secret. English/Spanish recovery browser tests pass.
Before production, provision the separate keys, execute the stopped-writer upgrade
and apply the existing retention policy to legacy backups. External proxy logging
and production secret custody remain deployment responsibilities.
Terminated database connections and lost replies have regression tests. The
[local management-database recovery drill](../database-recovery.md) now uses separate
non-superuser migration and runtime logins plus a replication-only login. It takes a
physical PostgreSQL 18 base backup, waits for a streaming standby to replay the named
recovery point, stops the primary and promotes the standby. The clean 2026-09-27
receipt at Cloud `072b2c0` confirmed zero lag at that point, a 158 ms local promotion
and a 934 ms local outage on that run. It recovered the exact result and lease after a discarded
committed reply, reclaimed an interrupted worker message once, preserved both tenants
and rejected a crossed installation proof. These are fixture measurements, not service
objectives. Repeat the drill with the selected provider's deployment credentials,
backups, replication, routing, monitoring and realistic data volume before launch.
Pairing and replacement now use venue locks compatible with monitoring's incident
inserts. PostgreSQL race tests run the real monitor worker while a new pairing
request waits on its installation lock: matching keys retain the existing link,
and different keys return a registration conflict while the incident commits.
A real PostgreSQL probe of two approved operations sharing one key and a genuinely
new venue completed with one shared link, so the proposed race was not reproduced
and gained no speculative regression. The adjacent existing-but-unlinked venue path
did expose a coverage gap: a new test pauses the first installation insert, and
deleting the venue lock reproduces a `registration_conflict` in the second operation.
A separate bounded abuse run admitted exactly 10 of 12 concurrent new pairings behind
one shared address across two API instances. Five guesses with unrelated UUIDs did not
spend the target request's failure budget; five concurrent wrong codes against its
known UUID serialized to five and closed it. That known-ID denial remains a deliberate
guess-limit trade-off. Keep request UUIDs out of logs and choose ingress or reissue
mitigation before changing the five-attempt rule.
