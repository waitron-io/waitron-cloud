# Venue lifecycle journal

When a service ends, a retry must not move its recovery deadline or repeat an
outside call whose reply was lost. The internal `LifecycleStore` records those
decisions in PostgreSQL. It has no HTTP route, provider adapter or running worker.
Recording a request grants no permission to stop, export, restore or delete data.

Use the current venue revision when you record a new request. An identical
operation ID returns its original revision, even after later requests. Reusing
that ID with changed input within the same venue conflicts. Another venue has its
own operation namespace. Different requests at the same revision
serialize, so only one can advance it. A cancellation records service end
separately from request receipt and fixes recovery end at 2,160 hours later.
An omitted service end uses the database clock. Retries and later cancellations
retain that deadline, including across leap days and daylight-saving changes.
Service end and the full recovery interval must fit within years 0001 through 9999.
Views and time comparisons use milliseconds. Storage preserves finer existing
timestamps; qualify matching comparison precision before another producer writes
finer deadlines.

The journal recognizes `active`, `exit preparing`, `read-only until deadline`,
`purging` and `purged`. A cancellation or deletion request can enter
`exit preparing`. It cannot reopen a read-only period. Resubscription at or after
the recovery deadline, during purge or after purge refuses. An earlier request
records intent only; a future adapter must prove that retained data exists before
reactivating service. This slice supplies no transition into read-only or purge.
Tests seed those states directly. A recorded purged row remains a tombstone;
this does not prove physical erasure or retention of every outside copy.

The deadline describes ordinary cancellation recovery. A deletion intent proves
neither verified deletion authority nor completed erasure. Later exit adapters
must give an earlier verified delete instruction priority over ordinary retention;
recording a cancellation cannot authorise a new waiting period for that deletion.

Before work, claim the operation using the current lifecycle revision. Only one
operation per venue can hold a live, 60-second database lease. Reclaiming expired
work increments its claim revision. Every effect write locks the lifecycle row
and checks both revisions and the lease. A new request invalidates old claims.
A fresh claim can reconcile an older operation using the current venue revision.

Record an effect's ID and request fingerprint as `intent` before the outside
call. Record its `confirmed`, `refused` or `uncertain` observation afterward.
An expired or invalidated claim turns outstanding intents into uncertain work.
The journal refuses another intent while an unresolved effect remains. Read that
effect and query the outside service before recording its outcome; the journal
does not perform or authenticate that query. Terminal outcomes and their resource
references cannot be rewritten. Store opaque resource identifiers and fingerprints,
never payloads, credentials or free-form customer text.

Run the focused PostgreSQL checks from the repository root:

```sh
node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test \
  test/data-lifecycle.test.ts test/data-lifecycle-restart.test.ts test/schema-compatibility.test.ts \
  test/data-lifecycle-upgrade-fixture.test.ts test/data-lifecycle-upgrade-recovery.test.ts
```

The restart fixture kills its own child after claim, intent, a simulated outside
call and observation. Its independent call ledger distinguishes a lost reply
from a call that never happened. These are local journal checks, not provider or
application stop, export, recovery, purge or deployment qualification.
Country bindings remain [D101 slice 5](superpowers/plans/2026-10-22-cloud-data-protection.md#slice-5-bind-placement-credentials-and-outbound-effects-to-policy).

The version 8 schema receipt binds the clean candidate to the actual 044-to-047
upgrade. Migration 046 already supplies venue service authority; migration 047
adds the journal. Upgrade checks retain every old row and SQL digest and require
the three new journal tables to start empty. Separate logical backups cover the
pre-upgrade database and the populated journal. After restoring the latter,
checks require the original operations, pending effects and fixed UTC deadlines,
then reclaim the expired claims and refuse the replaced worker. An uncertain call
cannot be retried as a new intent; its simulated status observation can be
recorded once and retried without changing the result.

The billing version 6 and venue-authority version 7 proofs still execute their
original tests in their exact delivered trees. Their schema pairs and strict
receipt validators remain fixed. The new lifecycle receipt adds current-candidate
coverage; these synthetic recovery checks grant no outside effect or activation
authority.
