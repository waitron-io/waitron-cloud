# Fiscal allocation registry

You cannot enable new fiscal allocations with an organisation login or a taxpayer
number alone. The registry requires independently verified taxpayer custody,
subscription entitlement, a current outside history and an externally supplied
signing key. All of those capabilities are unavailable by default.

The contract and storage stages define the receipt format and the PostgreSQL
projection. The current-history stage checks a signed outside journal and excludes
previous writers. Authenticated reservation, consumption, retained reads and paper imports now
use those checked facts through the account HTTP service. Signed machine reports record
reconciliation evidence without activating a node. The
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
runtime adapter or production values are supplied. Replay checks reservations, terminal consumption or abandonment, and linked
paper imports and signed machine reports. The fixture proves local process recovery, not independent
production storage or failure domains.

## Require current authority for each operation

Your full Cloud session and CSRF proof must still be valid after database locks
and outside requests finish. Organisation ownership controls which venue you
can inspect. The configured custody adapter establishes the taxpayer namespace,
local operator binding and complete series bases; a self-submitted NIF supplies
none of that authority. A reservation cannot omit your configured full series.
Changed bases require a fresh allocation before consumption.

The store locks the account and session before membership, venue and adapter
rows, then the taxpayer namespace. Two authenticated Node workers for separate
organisations reserve distinct C names within that one namespace. Neither can
read the other's venue receipts. Repeating an identical operation returns the
same signed receipt; changing its binding or bases refuses another claim.

Consumption or abandonment is permanent. Recovery consumption records the exact
old-machine isolation and no-parallel-recovery confirmation; initial setup
requires absence. The signed result records the currently authenticated Cloud
actor while preserving the original allocation and its full binding. This
confirmation does not establish that the old selling machine was fenced.

The entitlement adapter controls issuance and retained access separately. The
local fixture denies new reservations after entitlement ends while permitting
current authorised receipt reads. List cursors have signatures bound to your
account, venue and page size. Their stable positions span namespace histories,
whose sequence numbers may coincide.

## Import paper facts without freeing omitted names

A paper import preserves the entire signed block and its linked register revision.
It adds S/P reservations, consumption facts or signed venue transfers; it issues
no new identity. A stale exact retry returns its original acknowledgement. A new
upload cannot erase a previous consumption merely by omitting it, or transfer an
already consumed identity. A partial transfer keeps the original block and moves
only the named allocations.

Supply current paper public keys and custody version separately from Cloud receipt
trust. Explicit `paperHistoryTrust` can retain prior-version public keys for journal
replay. A new key re-signing an old block cannot change the register's custody
version. The current transfer format binds venue ownership; a qualified signed
key/custodian transfer format remains an owner enablement gate. The store refuses
that version change until the gated format and policy are supplied.

Run the authenticated store and paper checks from the Cloud checkout:

```sh
node scripts/test-postgres.mjs exec pnpm --dir packages/fiscal-allocation exec \
  node --test --test-timeout=30000 test/store.test.ts test/paper-import.test.ts
```

These checks use actual PostgreSQL locks and a separate persisted authority
process. The session-expiry case confirms that an outside append stays occupied
while expired authority receives no receipt and the local transaction rolls back.
No production continuity, custody, entitlement or signing adapter is enabled.

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
enable production allocation or replace the later joint Waitron recovery proof.

## Call the account service and recover a lost reply

Preserve the operation ID and the complete request when you lose a reply. Call
`POST /api/account/fiscal-allocations/status` with that ID and venue before deciding
what to do next. A routing hint commits before the independent append, so status
can recover the outside receipt even when its first PostgreSQL projection rolled
back. The hint supplies no allocation authority. An unknown result never permits
reuse of an identity.

Every account route requires your current full session, CSRF proof and exact
portal origin. A pending authenticator challenge is insufficient. Requests use
uncompressed JSON, a 16,384-byte cap and a five-second read deadline. Replies have
no-store caching; a response must fit within 256 KiB.

| POST suffix under `/api/account/fiscal-allocations/` | Request | Result |
| --- | --- | --- |
| `reserve` | Complete namespace, bases, venue and binding | Signed reserved receipt |
| `consume` | Allocation, binding and isolation or absence confirmation | Signed consumed receipt |
| `abandon` | Allocation and binding | Signed permanently abandoned receipt |
| `status` | Version, venue and operation ID | Recorded receipt, or unknown |
| `list` | Version, venue, signed cursor and page limit | Retained receipt page |
| `import-paper` | Complete signed block and linked register facts | Original import acknowledgement |

For example, query an unresolved operation using your own session credentials:

```sh
curl "$CLOUD_ORIGIN/api/account/fiscal-allocations/status" \
  -H "Origin: $CLOUD_ORIGIN" -H 'Content-Type: application/json' \
  -H "Cookie: cloud_session=$SESSION" -H "X-CSRF-Token: $CSRF" \
  --data '{"version":1,"venueId":"10000000-0000-4000-8000-000000000002","operationId":"10000000-0000-4000-8000-000000000001"}'
```

The loopback example uses the development cookie name. HTTPS uses
`__Host-cloud_session`. An unrecorded operation answers
`{"version":1,"state":"unknown","receipt":null}`. Disabled configuration answers
503. Invalid input answers 400, missing session 401, denied authority 403, changed
operation binding 409, and an exhausted request budget 429 with `Retry-After`.

All instances share PostgreSQL rate counters: 60 fiscal requests per IP per
minute, 30 per authenticated account, and 10 namespace mutations. The existing
120-per-minute overall IP limit also applies. Namespace allowance is spent only
after current session, ownership and custody checks. These build limits are not
subscription allowances or production throughput promises.

## Record a machine report without activating

`POST /api/installations/fiscal-allocations/report` accepts an envelope with
base64url `payload` and `signature`. The installation signs canonical UTF-8 bytes
of `["waitron.fiscal-machine-report",1,origin,"report",installationId,operationId,
issuedAt,lease,bodyDigest,body]`. `issuedAt` is milliseconds since the Unix epoch;
`bodyDigest` is lowercase SHA-256 of canonical `body`. `lease` is the original
canonical JSON string of the registration-signed lease envelope.

The exact body holds `venueId`, `scope`, `receipt`, `paperHistory` and
`activationEvidence`; exactly one receipt or paper history is non-null. The
activation evidence shares the request byte limit and records a caller's evidence, not proof
that Cloud activated a node. Machine-origin browser requests refuse. The current
stored installation key, revocation state, venue, environment and active lease
are checked under the installation lock, and checked again after outside waits.
Machine counters allow 60 requests per IP and 30 per verified installation per
minute.

A known consumed Cloud receipt returns `matched`. A reserved or conflicting
receipt returns `conflict`. An exact imported paper history returns `matched`;
a changed signed allocation or consumption returns `conflict`; other verified
paper evidence returns `recorded` without importing it. Results have the shape
`{"version":1,"state":"matched","receiptId":"..."}`; paper results use null for
the receipt ID. Exact report retries retain the original result, including after
an outside append followed by a failed PostgreSQL commit.

Supply the report origin and retained registration lease public keys through the
explicit `machine` option. Historical journal replay verifies the original proof
at its recorded time; current requests still require the live installation key
and lease. Keep the required old public keys for replay. No private key, production
lease configuration or provider is supplied by default.

Run the real listener, PostgreSQL, factor-challenge, rate and lost-reply checks:

```sh
node scripts/test-postgres.mjs exec pnpm --dir packages/account-http exec \
  node --test --test-timeout=30000 test/fiscal-allocations.test.ts
```

The phone journey and the actual Waitron recovery adapter remain separate work.
A machine report never grants a name, changes consumption, activates trading or
proves that the old selling machine stopped.
