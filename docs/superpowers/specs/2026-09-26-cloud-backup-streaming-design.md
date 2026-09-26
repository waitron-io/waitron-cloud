# Cloud backup streaming design

## Outcome and boundaries

Waitron Cloud must stop holding a complete managed snapshot in memory while it checks, republishes, verifies, or downloads that object. The change applies to Cloud's existing S3-compatible retained-snapshot path. It does not change the Waitron archive format, encryption performed by Waitron, database metadata, object names, SHA-256 identity, conditional-create rule, provider-side SSE-C headers, or the advertised 512 MiB archive ceiling.

Waitron still owns archive creation and restoration. Cloud still receives an already encrypted archive, validates its exact byte identity, copies it from `incoming/<capture>` to `snapshots/<capture>`, and supplies it to the isolated Waitron verifier. Any change needed in Waitron's writer or recovery client remains a dependency for another lane.

## Consumer trace

`BackupObjects` is constructed by the backup worker configuration and the local backup/storage proofs. `BackupCatalogue.publish()` currently reads an incoming object into a `Buffer`, hashes it, and uploads that same buffer. `BackupCatalogue.verify()` reads the retained object into a `Buffer`, hashes it, and gives it to `BackupWorker`'s restore callback. `createWaitronVerifier()` then writes that buffer to its private scratch directory. The local recovery proof also reads an entire object before writing it to the recovery input file. Test stores implement the same `read`/`put` contract in memory.

The account capture endpoint does not proxy archive bytes. It issues a scoped provider grant, so the upload from Waitron to `incoming/` is already outside Cloud process memory. Managed continuous streams use a separate Waitron-owned protocol and are not changed here.

## Design

Add a replayable staged-object abstraction in the backups package. A staged object has an immutable `ObjectReceipt`, can open a fresh readable stream from byte zero, and has an explicit asynchronous disposal operation. Production downloads stream provider bytes into a mode-0600 file under a private temporary directory while a transform computes SHA-256 and counts bytes. The operation rejects empty, oversized, truncated, cancelled, or late data and removes partial files before returning.

`BackupObjects` exposes the staged download and upload operations while retaining the small-buffer helpers used by narrow tests and scripts. Upload receives a staged object, supplies its known content length, conditional-create header, and existing SSE-C headers, and opens a fresh stream for each bounded retry. A conditional-write collision is accepted only after streaming the stored object and matching both digest and size. This preserves retry identity without trusting a mutable caller buffer or attempting to rewind a consumed network stream.

`BackupCatalogue.publish()` stages `incoming/<id>`, compares the staged receipt with signed metadata, uploads the same staged bytes to `snapshots/<id>`, performs the existing capture-expiry and authority fences, and always disposes the stage. `verify()` stages the retained snapshot, validates its receipt, passes the replayable object to the restore callback, and always disposes it. The isolated Waitron verifier pipelines the staged stream into its own scratch input rather than copying a full buffer. In-memory test stores use a small replayable buffer adapter so existing behavioural assertions remain meaningful.

## Failure handling

- The existing 30-second object-operation deadline remains the default and composes with a caller cancellation signal. Cancellation destroys the transfer and removes partial scratch data.
- Content length must be an integer from 1 through 512 MiB and must equal the streamed byte count. Missing, truncated, or oversized objects fail as `backup.object_invalid`.
- SHA-256 and size are calculated from bytes actually written to the stage. Publication compares them with the signed metadata before any durable catalogue row is inserted.
- Upload retries reopen the same staged file. Only transient transport/service failures are retried, at most once; conflicts use the existing read-and-compare rule.
- An SSE-C request still requires an `AES256` confirmation on a successful write. A wrong key/tag is refused by the provider and cannot be converted into a successful receipt.
- Capture expiry and worker lease fences remain database checks around, not inside, the external transfer. A transfer that outlives authority cannot publish a point.

## Verification

Unit tests first prove bounded staging, exact digest/size, truncation cleanup, cancellation cleanup, expiry/deadline failure, replay from byte zero, and conditional-conflict comparison. Catalogue tests prove publication and verification use the staged path, preserve immutable metadata and capture-expiry fences, and dispose stages on every outcome. Verifier tests prove streamed input reaches the actual child restore path and scratch cleanup still occurs.

The local S3-compatible proof uploads and downloads a generated large object without constructing one archive-sized buffer, checks the digest, exercises conditional conflict and wrong SSE-C keys, and records peak process memory growth. The measurement is local evidence only. The final focused gates are the backups package tests, real PostgreSQL catalogue/worker tests, workspace typecheck, the storage proof, and the existing two-venue backup proof when its Waitron checkout is available.

## Documentation

`docs/backlog.md` and `docs/local-backups.md` will say exactly which Cloud paths now use bounded memory. They will keep the 512 MiB end-to-end limit and list Waitron archive assembly/restoration plus live AWS/Google behavior as remaining work.
