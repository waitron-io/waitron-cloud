# Fiscal allocation registry

You cannot enable new fiscal allocations with an organisation login or a taxpayer
number alone. The registry requires independently verified taxpayer custody,
subscription entitlement, a current outside history and an externally supplied
signing key. All of those capabilities are unavailable by default.

The contract and storage stages define the receipt format and the PostgreSQL
projection. The current-history stage checks a signed outside journal and excludes
previous writers. Authenticated reservation, paper import and HTTP services remain
to be implemented. The
[shared implementation plan](https://github.com/clintongormley/waitron/blob/main/docs/superpowers/plans/2026-10-12-cloud-fiscal-allocation-registry.md)
owns those stages and the later phone and Waitron journeys.

## Preserve names outside a restored database

A namespace combines the taxpayer NIF, two-character software ID and fiscal
environment. It spans organisations and venues. Cloud's `test` registration value
maps to fiscal `preproduction`; its `production` value maps to `production`.

The Cloud namespace contains only `C000001` through `C999999`. A current paper custodian owns
`S` and `P` names in separate spaces. Zero and exhaustion refuse further short
allocation. An emergency identity contains `E` followed by 26 Crockford characters,
with a first suffix character from `0` through `7`. This package validates those
values; it generates no emergency or paper names.

Every allocation freezes its complete configured series and their purposes,
including `full` series such as `FF`. A series base has at most 21 characters.
The installation identity has at most 27, so a series with the ten-digit maximum
invoice counter fits the 60-character invoice limit. Validation uses the actual
`@waitron/verifactu` 0.2.1 builder and validator with complete synthetic records.
This checks format compatibility, not taxpayer custody or permission to trade.

PostgreSQL stores the projected namespace, immutable allocated names and immutable
registry and paper events. Its migration adds no issuance permission. Historical
facts refuse updates, deletion and truncation, including cascading truncation;
foreign keys prevent deletion of their venue or account. A migration owner can
still change the schema. Physical backup recovery supplies neither a current
outside journal nor permission to reissue a name missing from that backup.

## Reconcile the outside history before writing

A restored database can omit a name that was reserved after its backup. Before
you allocate another name, `requireCurrentHistory` challenges the configured
outside authority with fresh unpredictable values, verifies its pinned public
keys, and checks the complete uninterrupted journal against the signed current
head. Historical receipt signatures alone do not establish currentness.

`fenceWriter` obtains a signed, expiring writer grant that includes the writer ID
and an increasing fence number. The authority rejects the previous writer on every
append. After an append loses its reply, `appendEvent` reads current history for
that exact operation and request digest. A confirmed result returns the original
receipt; an unknown outcome refuses another optimistic allocation. Confirmed
contention may retry against newly read history.

`projectHistory` replays those verified facts inside your existing PostgreSQL
transaction. It compares complete existing rows rather than overwriting history
or freeing absent names. Evidence that expires while waiting for a database lock
refuses. A failed database commit leaves the outside name occupied; the next
current-history read projects the retained signed result again.

The local fixture uses a separate Node process with its own persisted journal and
two registry worker processes. Its dump/restore check reserves C000042 after the
backup, refuses that candidate from the restored state, reconciles it and then
permits C000043. Its restart and failed-commit checks retain the exact original
receipt. Run these checks from the Cloud checkout:

```sh
node scripts/test-postgres.mjs exec pnpm --dir packages/fiscal-allocation exec \
  node --test --test-timeout=30000 test/continuity.test.ts
```

Supply the authority ID, pinned public keys, receipt trust and explicit bounded
timing policy through the injected adapter's `verification` configuration. No
runtime adapter or production values are supplied. This stage replays Cloud
reservation events; other journal actions refuse until their full replay rules
are implemented. The fixture proves local process recovery, not independent
production storage or failure domains.

## Keep the complete signed receipt

The manual packet starts with `WAITRON-FISCAL-ALLOCATION-1:`. Its remainder is
unpadded base64url encoding of canonical UTF-8 JSON. Object keys have recursive
lexical order; arrays preserve their original order. The packet must reproduce
those bytes exactly and fit within 12 KiB.

The Ed25519 signature covers the canonical array
`["waitron.fiscal-allocation-receipt", 1, keyId, payload]`. The key identifier is
lowercase SHA-256 of the public key's SPKI DER bytes. Supply public SPKI and private
PKCS8 DER keys as unpadded base64url strings through explicit injected configuration.
The package stores no private key in PostgreSQL or a receipt.

The payload binds the namespace, complete series, event, operator, source, target,
mode, account, venue, custody and entitlement versions, and continuity witness.
A consumed receipt also binds the complete isolation or initial-setup confirmation.
A reserved receipt is insufficient for local activation. Local recovery must still
verify its own authenticated operator and exact committed result.

Choose trusted public keys explicitly. You can retain old keys for historical
verification while retiring their ability to sign new receipts. Removing a key
from the trust set refuses its receipts. Paper custody uses a separate trust set
and custody version; a Cloud receipt key grants no paper custody. The owner's
compromise and rotation policy must determine which historical keys remain trusted.

Requests admit at most 20 series bases and 16,384 UTF-8 bytes. A paper import keeps
its entire original signed block, with at most 20 allocations, 20 consumptions and
20 transfers; each transfer contains at most 20 allocation IDs. Larger blocks or
requests refuse instead of truncating signed data. A replacement export requires
the current custodian, without freeing or minting replacement names.

## Run the contract and storage checks

From the Cloud checkout, run:

```sh
node scripts/test-postgres.mjs exec pnpm --dir packages/fiscal-allocation exec \
  node --test --test-timeout=30000 test/contract.test.ts test/schema.test.ts
pnpm typecheck
node --test scripts/ci-workflow.test.mjs scripts/database-recovery-migrations.test.mjs
```

The database checks use a populated release-37 fixture and two independent migration
connections. They also cancel the new migration at its ledger write, retry it,
exercise a restricted runtime role, and check exact migration compatibility.
These local checks do not qualify an independent production history authority,
enable the HTTP API or replace the later joint Waitron recovery proof.
