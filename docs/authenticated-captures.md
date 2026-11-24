# Deliver snapshots from a connected Waitron server

A paired test installation can reserve an upload and publish its archive
through the account HTTP service. You still provision its storage with the trusted
operator API. The installation cannot choose its destination, read retained archives
or mark an upload as verified.

## Enable the local adapter

Apply all current migrations, including 016. Configure the account server's usual
email, rate-limit and installation-issuer settings, plus the backup worker's
`CLOUD_BACKUP_MASTER_KEY`, `CLOUD_BACKUP_ENDPOINT`, `CLOUD_BACKUP_REGION`,
`CLOUD_BACKUP_ACCESS_KEY`, `CLOUD_BACKUP_SECRET_KEY` and optional
`CLOUD_BACKUP_SESSION_TOKEN` / `CLOUD_BACKUP_CA_FILE`.

Set `CLOUD_BACKUP_AUTHORITY` to a JSON object with `issuer`, `audience`, `keyId`,
`privateKey` (RSA PEM, at least 2048 bits) and `roles` with `capture`, `stream` and
`restore` role names. Configure that issuer's public JWKS and matching scoped policies
in your local storage provider. Treat this setting as a secret. The executable
[local proof](local-backups.md) creates the disposable issuer/provider configuration
for you; this does not configure an AWS account.

Run `pnpm account:serve`. With no backup settings, capture endpoints return 503.
Partial settings fail startup. Cloud pins object access, upload signing and token
exchange to the operator's configured storage endpoint and region.

## Reserve, upload, publish

Use Waitron's `createCloudConnection(options).reserveCapture(captureId)` to obtain
`id`, `installationId`, `venueId`, `keyVersion`, `location`, `incomingKey`,
`recoveryKey`, `credentials` and `expiresAt`. Keep the capture UUID and use the returned
recovery key to create the encrypted Waitron archive. The grant includes no stream key.

Call `uploadCloudCapture(grant, bytes)` in Waitron, then
`connection.publishCapture(captureId, metadata)`. Metadata contains `digest`, `size`,
`capturedAt`, `retention` (`daily` or `monthly`), `sourceNodeId` and `modules`. The
published result starts with `verification: "pending"`; the background restore worker
supplies verification separately.

Keep the same UUID, bytes and metadata when retrying. Reserve renews temporary upload access
against the original key version, even after key rotation. A repeated
upload can receive an object-exists response; publication checks its actual digest
and size. Changed metadata conflicts. Exact publication retries return the saved point,
including after the capture's ordinary deadline. Waitron now runs scheduled delivery
for a configured test installation on its serving primary.

Captures expire after 24 hours. Upload grants last at most 15 minutes. Stopping
Cloud access or disabling the service prevents new grants and publication. Issued
grants remain usable until they expire. Abandoned upload cleanup waits beyond that
expiry. Cloud enforces the 512 MiB archive ceiling at publication for direct uploads.

## Wire contract

POST `/api/installations/backup-reserve` or `/api/installations/backup-publish` with the
existing canonical signed machine envelope. Use the capture UUID as `operationId`.
The signed reserve body is exactly `{}` for a scoped storage session or
`{"upload":"presigned-put-v1"}` for a signed upload URL. Publish signs the metadata JSON string.

A box that can reach direct HTTPS storage can opt in to receive `uploadUrl` in
place of `credentials`. Cloud signs a PUT for the reserved bucket and exact
`incoming/<captureId>` key with `If-None-Match: *`. Send that header with the
archive and treat HTTP 412 as an existing upload to check through publication.
Keep the URL in memory and out of logs. Cloud rechecks the installation's
permission and storage destination before it returns the URL. The URL uses
Cloud's existing storage identity, so the reserve does not need to mint a
temporary storage session.

Older Cloud releases and the HTTPS upload proxy return HTTP 400
`invalid_metadata` for this opt-in. A box can retry with `{}` on that response.
A signing failure returns HTTP 503 `temporarily_unavailable`. The disposable
test-cloud withdrawal proof explicitly signs a `{}` reserve so it can observe
the expiry of a legacy storage session after a downgrade.
Include the current bound control lease. Browser Origin headers are refused.
Both endpoints share existing installation/IP allowances and return no-store responses.
In test venue-level mode, publication has up to 45 seconds from the account
request. Only a currently verified proof can admit the copy, and its issued time
can shorten the work budget to 55 seconds after signing. Keep your box clock
in sync with Cloud. A clock 55 seconds behind leaves no time to publish. The
box receives HTTP 503 with `temporarily_unavailable` and `Retry-After: 1`.
Cloud rechecks live authority and proof age before committing the point.
If the point commits and upload cleanup takes the request past its time limit,
retry with the same capture ID and metadata to retrieve the saved point.

Invalid proof returns 401, revoked/disabled/non-test authority 403, changed capture or
object metadata 409, expired capture 410, shared rate limits 429 and temporary
storage/configuration errors 503. Envelope/body syntax follows the existing 400/413
limits. Capture operations do not write installation operation-history rows. The capture and
point records supply retry identity; neither stores upload grants or plaintext recovery keys.

Run the two-server proof in [local backups](local-backups.md) to exercise actual
Waitron signatures, scoped object upload retries, publication retries, rotation and
restore. PostgreSQL tests separately cover revocation during provider waits and lease
expiry while an installation lock or object write blocks.

## Scheduled delivery and restart

Waitron takes a first snapshot when the service is configured, then runs daily after
its venue business-day cutover using the existing stable scheduling offset. The first
successful capture in a venue-local calendar month gets monthly retention. Restart
keeps the saved next due time; a missed run creates one current snapshot.

The server stores one pending encrypted archive and its capture ID/metadata under
`cloud-snapshots` in its state directory. It does not save temporary upload credentials
or the Cloud recovery key. A retry first asks Cloud to confirm publication, then renews
credentials if delivery was not acknowledged. Confirmed uploads are recorded so a
publication outage does not resend the archive. If storage loses an acknowledged object,
publication is retried until the 24-hour limit, then a current copy replaces it. A lost successful publication reply can therefore
be recovered after the upload deadline. After 24 hours, an unpublished capture gets one
last publication attempt before Waitron discards it and makes a current copy.

The file uploader streams from disk and verifies the saved size and digest before
sending. Each attempt is bounded by 14 minutes or credential expiry minus five seconds,
whichever is earlier. Failed attempts back off from one minute to at most 15 minutes;
shutdown cancellation does not record an outage. Queued capture requests are cancellable;
shutdown waits for any current local database copy or encryption step before closing the
database. Local operator-key backups keep their
own schedule and destinations. Disabling the Cloud service pauses its pending delivery;
revocation or a changed installation binding discards the pending archive.

Archive assembly still uses the existing in-memory format and the 512 MiB bound.
Temporary plaintext database copies are kept in a private staging directory, removed
after capture and cleaned on the next eligible worker tick after a crash. Allow space
for staging as well as the encrypted archive. Production uplink sizing and archive
format streaming remain follow-ups. The local proof checks process restart and restore;
the HTTPS test checks an acknowledgement delayed beyond 30 seconds, not a production
throughput guarantee. Malformed local metadata fails visibly instead of resetting the
schedule silently.
