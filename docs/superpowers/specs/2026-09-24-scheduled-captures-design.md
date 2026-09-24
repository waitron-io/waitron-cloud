# Scheduled Cloud snapshots

Continue the authorised local integration sequence: scheduled snapshots, self-service
remote setup, then customer recovery. Free address lookup/email remain backlog only.

## Scheduled delivery

A paired test installation with retained snapshots configured takes an initial snapshot,
then one daily using Waitron's existing venue-clock schedule calculation (business-day
cutover plus its stable jitter). The first successful capture in each venue-local calendar
month gets monthly retention. Persist the next due time so restart does not create another
snapshot; a missed schedule creates one current copy rather than a historical backlog.

Keep Cloud-managed captures independent of the operator-key local destinations: their
keys, delivery state and retention differ. Reuse existing archive assembly and schedule
math. Boot owns a separate abortable loop, gated by the live serving-primary role and
Cloud service state. It must not block normal local backup delivery or selling.

## Durable retries

Keep at most one pending encrypted archive and bounded JSON metadata under the state
directory, outside the archive's captured files. Use private directories/files and atomic,
flushed writes. Persist the capture UUID before reservation, and persist ciphertext and its
metadata before uploading. Never persist the recovery key or temporary credentials.
Resume the same bytes, capture UUID and metadata after a restart. Attempt publication
first for a completed local archive: a lost successful response can then finish even after
upload authority expires. Persist acknowledged uploads so publication failures do not resend the archive. Renew
upload authority only when delivery was not acknowledged. If storage loses an acknowledged
object, retry publication until the 24-hour limit, then capture a current copy.
Check the stored key version and installation binding before retrying an upload.

A capture that exceeds its 24-hour lifetime gets one final publication attempt before it
is discarded and a fresh snapshot is scheduled. Revocation or an installation change
clears the pending archive; disabled service pauses delivery. One worker owns the spool;
serialise its ticks. A malformed state file fails visibly and is not silently overwritten.
Retry transient failures with a bounded backoff, without creating extra archives. Aborted
shutdown work is not reported as a failed backup. Waiting capture requests can be cancelled
without cancelling the request ahead of them. Shutdown waits for the current local database
copy or encryption step; cancellation is checked between these steps. Remove abandoned
temporary files without following symlinks; retain malformed committed state for diagnosis.

Stream the encrypted file to storage, with a bounded transfer time within credential
expiry and no SDK retries on an already-consumed stream. Keep the current 512 MiB
archive-format limit explicit; archive creation still uses the existing in-memory format.
Local transfer experiments establish the tested budget, not a production uplink promise.

## Proof and release boundary

Use real disk/restart tests for interrupted creation/upload/publication, exact bytes,
expired captures, monthly/daily selection, bounded storage, role changes, revocation and
cancellation. Exercise the production capture builder and worker in the two-server local
backup proof, preserving independent restore/content and excluded-secret assertions.
No public deployment or production-environment grants in this slice. Existing Cloud
catalogue verification remains separate from upload completion.
