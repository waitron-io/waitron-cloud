# Management schema upgrade and recovery

D34 authorises this rehearsal and inline execution under the campaign runbook.

## Design

Exercise revision `9a56d0122bf6872a0200735a7b1e3a23ad4f825c` (26 migrations)
against `eafd97ad5ac51563e91c821d4c957ef996e5d3fb` (27 migrations), using their
unmodified SQL and application commands. The current checkout supplies the deployment
schema gate and proof driver; record its revision separately. Use disposable PostgreSQL
and Mailpit, two organisations/installations, encrypted mail, and a pending pairing.

Stop consumers before migration. Permit a database consumer only when every migration
name and content digest matches its release. This is a conservative deployment policy,
not a claim that every older query is incompatible. Historical binaries lack that gate;
run them through the current deployment gate, and record that distinction. Gateway and
storage processes do not consume PostgreSQL. Reject unknown migrations before applying
any SQL. No downgrade migration or mixed-version service is supported.

Hold a lock on pairing_requests to interrupt the real 027 migration mid-transaction,
terminate the migration backend, verify rollback, and retry. New consumers must refuse
the old schema both before and after interruption. Upgrade legacy pairing verifiers
with the separate retained pairing key before new account traffic. Preserve identity,
registration completion retries, tenant boundaries and the pending encrypted mail.

Take a pre-upgrade pg_dump. Restore it into a second isolated PostgreSQL database and
restart the old consumer with matching external keys. Verify encrypted mail cannot be
opened with a wrong key, retries and tenant isolation still work, and the original
upgraded database remains unchanged. This is recovery to a named backup, not reverse
migration or preservation of post-backup writes.

## Execution

1. Add red tests for consumer schema mismatch, digest mismatch, unknown migration and
   upgrade stop ordering. Add exact schema validation at the packaged runtime boundary,
   reject unknown migrations in migrate, and stop the local stack before recreation.
2. Add a versioned receipt verifier with rejection tests for missing evidence, identical
   schema versions, failed cleanup and unpinned revisions.
3. Implement the isolated proof using pinned history checkouts and their locked dependencies.
   Run migration/startup, interruption/retry, data/identity/isolation and separate recovery.
   Retain timings, revision/digest receipts and cleanup evidence outside the checkout.
4. Prove the critical startup guard by deletion in a disposable copy, update deployment
   and recovery docs and the tracked backlog. Commit with sign-off, then finish-branch
   with the Claude run-it seat, exact-head CI, locked landing and exact-merge CI.

## Review focus

A newer ledger must not be accepted by a historical consumer through the gate. A failed
migration must leave neither its ledger row nor partial DDL. Startup must not run before
the guard succeeds. Recovery must not overwrite the upgraded fixture. Receipt verification
must reject missing checks rather than treating absent evidence as success.
