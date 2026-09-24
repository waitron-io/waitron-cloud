# Local managed backups and recovery

The owner authorised the five-task programme, local integration first, with design
choices delegated and automatic finish/land. This is the fifth task. No AWS resources
or live customer data are involved.

## Outcome and boundary

Connect two real Waitron test venues to independent S3 storage scopes. Keep encrypted
snapshots independently of the continuous stream. Record an actual recoverable time
and restore through Waitron onto a disposable replacement. Cloud permission must
never activate fiscal trading. The original server need not supply a recovery key.

Cloud owns storage authority, protected key versions, the immutable recovery catalogue,
verification records, retention and owner-authorised recovery operations. Waitron owns
capture, schema checks, integrity checks, required secrets and module restore hooks.
Use its existing encrypted archive path for snapshots. Do not build another database
restore engine in Cloud.

Waitron's slice-2 stream work is progressing separately. Its sealed state row and cold
restore path are prerequisites for a complete continuous server restore. A successful
raw SQLite/Litestream restore is evidence about storage, not a complete server backup.
Do all independent Cloud and snapshot work while these prerequisites progress; record
any still missing dependency explicitly rather than fabricate a substitute state format.

## Storage and keys

Use SeaweedFS 4.47 locally, with a SHA-256-pinned release, loopback binding and a private
test CA. Use real TLS verification. A provider probe against Versity 1.8.0 returned
plaintext without the SSE-C key and with a wrong key; SeaweedFS returned 400 and 403,
respectively, and 200 with the correct key. This selects the local test provider only.
The production target remains AWS Spain; its deployment and provider validation are later.

Each venue gets its own bucket and a server-selected prefix. Stream and retained archive
scopes are separate. Obtain short-lived storage credentials through the provider's
security-token service; check actual cross-venue, cross-kind and expiry refusal.
Snapshots use immutable, server-assigned object keys. Capture authority cannot remove
retained snapshots or obtain another venue's keys. Restores receive read-only authority.

Generate separate random archive recovery and stream-encryption keys per version.
Seal them in PostgreSQL with AES-256-GCM under an operator-held master key, with venue
and version as authenticated context. Persist only encrypted secrets and public key
references. Rotation creates a new version; retained points still reference their old
version. No key-deletion operation is introduced. Never put secrets in browser status,
logs, process arguments or unencrypted operation results.

## Catalogue and verification

A point records venue, source installation, environment, kind, server-assigned object
identity, digest and size, capture/recovery time, module/schema metadata and key version.
Verify uploaded bytes from storage before publication. Repeated publication with the
same identifier and contents returns the same point; changed contents conflict.

Keep upload completion separate from restoration verification. A trusted verification
worker downloads the exact object and calls Waitron's validation and restore code in an
isolated destination without starting fiscal, payment or notification workers. Record
worker version, digest, time and result. A reported upload cannot mark itself verified.
A missing, altered or incompatible object is a failed verification, never healthy.

Continuous points must name the generation and actual restored end point. Do not infer
a recovery timestamp from S3 modification time. Prefer the latest verified continuous
point when available; offer a retained snapshot explicitly when the stream is missing.
A snapshot restores to its own capture time and never has later stream changes applied.

## Retention and recovery operations

Daily snapshots: 30 days; monthly snapshots: 12 calendar months. Protect the newest
verified retained snapshot while the subscription is active. Verification failure must
not replace that protected point. Cleanup rechecks protection and active recovery use
under the venue lock, marks a point deleting before deleting storage, and resumes after
an interrupted delete. Deleting points cannot be selected for recovery.

An owner session plus CSRF proof starts one durable operation per venue. Bind its id to
mode (planned/failure), exact selected point, a fresh target public key, and explicit
old-server/data-loss confirmations. Retrying identical input returns the same operation;
changed input conflicts. A non-owner or another organisation is refused. Recheck the
session and membership before committing the operation.

The target must prove possession of its bound key before obtaining recovery secrets.
Record restore success separately from activation. Cloud cannot treat its own grant as
Waitron's permission to trade or reroute staff traffic. Credential retirement and final
activation must use the concrete Waitron replacement contract when available; this
local slice does not silently alter the existing one-installation-per-venue constraint.

## Verification

Use failing behavioral tests first, real PostgreSQL concurrency, a real TLS S3 service,
real Waitron archives and its restore code. Prove two-venue isolation, wrong/absent
keys, immutable publication, bad digest/size, owner authority, lost replies, key rotation
with an older snapshot, failed verification, last-verified retention and interrupted
cleanup. Run Litestream 0.5.17 against the same provider and prove restored writes.
The full programme acceptance remains open until a complete continuous restore and
replacement activation have passed through Waitron's own implementation.

## Sources

- [SeaweedFS OIDC/STS configuration](https://github.com/seaweedfs/seaweedfs/wiki/OIDC-Integration).
- [SeaweedFS SSE-C](https://github.com/seaweedfs/seaweedfs/wiki/Server-Side-Encryption-SSE-C).
- [Litestream configuration](https://litestream.io/reference/config/).
- Waitron slice-2 spec and plan, existing `backup-sweep.ts`, `restore.ts` and `state-secrets.ts`.
