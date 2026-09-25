# Cloud-managed continuous recovery

## Outcome and boundary

When a test venue loses its original server, you can restore the latest recoverable
Litestream generation without a saved recovery key. Cloud supplies a venue-scoped
bucket configuration and the recovery key to the original Waitron server, verifies
Waitron's signed current-generation pointer from storage, shows the verified recovery
time, and releases a recovery kit only to the owner-approved replacement. If the
continuous copy is missing, you can still choose the existing verified snapshot flow.

Cloud owns storage credentials, protected recovery keys, owner approval, verified
recovery evidence and orchestration. Waitron owns the stream writer, pointer signature,
sealed node state, database restore, module hooks, node identity and local placement.
This change does not add a second restore engine or edit Waitron.

The local proof uses static SeaweedFS credentials restricted to one venue bucket and
prefix because the landed Waitron stream contract stores an access-key pair and has no
session-token refresh field. Production must provide an equally scoped credential
adapter, rotation and revocation before launch. The local adapter is not an AWS claim.

## Managed stream configuration

Add an authenticated machine exchange with two actions:

- `backup-stream-configure` accepts the Waitron local venue UUID, source node UUID and
  pointer-signing Ed25519 public key. Cloud selects the existing backup location,
  prefix and provider credentials. It returns a Waitron `BucketConfig`-shaped object
  and the active Cloud-managed recovery key. Exact retries return the same binding;
  changed source identity or signer refuses with conflict.
- `backup-stream-observe` accepts no caller-supplied result. Cloud reads
  `<prefix>/venues/<localVenueId>/current.json` itself, checks the pointer shape and
  signature with the registered signer, and records its generation, source node,
  `writtenAt` recovery time and Cloud receive time. A caller cannot invent freshness.

Both actions use the existing installation proof and live lease. They recheck the
current installation, configuration revision and service state after provider waits.
A late observation from a revoked or replaced installation cannot overwrite the
current row. A valid older pointer also cannot move the recorded recovery time back.

PostgreSQL stores provider credential references, never access-key secrets. The
provider adapter resolves writer and recovery references from its own secret store.
The local adapter keeps them only in the disposable proof process.

## Recovery selection and secret delivery

The public backup catalogue adds nullable continuous evidence:
`recoverableAt`, `checkedAt` and `sourceNodeId`. It is available only while the recorded
stream belongs to the current installation and has verified pointer evidence. Snapshot
rows and their default remain unchanged.

Owner approval chooses either `continuous` for the displayed current generation or
`snapshot` with an exact point UUID. The recovery row freezes the selected generation,
recovery time, source node and stream configuration revision. Later observations do
not silently change an approved operation. Existing snapshot rows remain valid through
the migration and keep their current API shape.

The replacement continues to prove its fresh Ed25519 key through the existing
`info`, `read` and `restored` protocol. For a continuous operation, `read` returns one
Waitron recovery-kit value containing the frozen venue, bucket read authority, recovery
key and pointer signer. It never enters a browser response or log. Snapshot `read`
continues to return one-object credentials and the archive key. Closing an operation
prevents new reads but cannot recall a kit already delivered.

Cloud records `restored` separately from replacement and activation. Owner-confirmed
server replacement remains the action that retires old Cloud installation authority
and moves routes. The proof never starts trading, promotes automatically or claims a
running old server was fenced merely because recovery access was approved.

## Portal behavior

The English and Spanish recovery screen recommends the latest continuous point when
one exists and shows its verified recovery time. You can select the retained-snapshot
fallback explicitly. The confirmations say that all servers with newer data are
stopped and that later changes will be lost. Approved-operation status names its source
and time without exposing generation names, bucket paths or credentials.

An unavailable or stale continuous point is not presented as healthy. If storage
evidence disappears after the catalogue was loaded, approval fails safely and the
owner can refresh or choose a verified snapshot.

## Local proof

Extend the existing two-venue proof. Give each real Waitron server a separate static
credential restricted to its own stream prefix, apply the configuration through
Waitron's existing authenticated stream settings API and let its real supervisor write
the signed pointer and sealed state. Cloud then observes both pointers.

Stop the original servers. Start one normal matching-code recovery, approve its latest
continuous point through the owner HTTP flow, deliver the kit to a disposable target
and invoke Waitron's landed `waitron-restore restore --from-bucket` path. Check the
restored venue, sealed module state, interruption/retry behavior and that the other
venue remains inaccessible and unchanged. Remove one venue's continuous data and prove
the existing verified snapshot path still restores. The receipt records exact Cloud
and Waitron heads, measured recovery times, selected sources and no activation.

## Deferred production work

Production still needs a provider adapter that creates, rotates and revokes static or
renewable Waitron-compatible stream credentials, live AWS/Google contract checks,
continuous retention policy, monitoring alerts for missing observations, planned
final-write handover, and a source-side delivery journey that applies Cloud's managed
configuration without exposing credentials to the browser. These are explicit launch
requirements, not behavior implied by this local proof.
