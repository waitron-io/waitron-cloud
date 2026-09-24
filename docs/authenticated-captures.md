# Deliver snapshots from a connected Waitron server

A paired test installation can now obtain upload credentials and publish its archive
through the account HTTP service. You still provision its storage with the trusted
operator API. The installation cannot choose its destination, read retained archives
or mark an upload as verified.

## Enable the local adapter

Apply the existing migrations through 013. Configure the account server's usual
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
Partial settings fail startup. Both object access and token exchange are restricted
to the operator's configured endpoint and region.

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

Keep the same UUID, bytes and metadata when retrying. Reserve renews temporary
credentials against the original key version, even after key rotation. A repeated
upload can receive an object-exists response; publication checks its actual digest
and size. Changed metadata conflicts. Exact publication retries return the saved point,
including after the capture's ordinary deadline. Scheduling and durable local archive
spooling are the next Waitron task; these methods do not run backups automatically.

Captures expire after 24 hours. New storage credentials last at most 15 minutes. Stopping
Cloud access or disabling the service prevents new grants and publication, but already
issued storage credentials remain usable until they expire. Abandoned upload cleanup
waits beyond that expiry. Archives remain bounded to 512 MiB in this local adapter.

## Wire contract

POST `/api/installations/backup-reserve` or `/api/installations/backup-publish` with the
existing canonical signed machine envelope. Use the capture UUID as `operationId`.
Reserve's signed body is exactly `{}`; publish's body is the metadata JSON string.
Include the current bound control lease. Browser Origin headers are refused.
Both endpoints share existing installation/IP allowances and return no-store responses.

Invalid proof returns 401, revoked/disabled/non-test authority 403, changed capture or
object metadata 409, expired capture 410, shared rate limits 429 and temporary
storage/configuration errors 503. Envelope/body syntax follows the existing 400/413
limits. Upload grants and recovery keys are not saved in operation-result history.

Run the two-server proof in [local backups](local-backups.md) to exercise actual
Waitron signatures, scoped object upload retries, publication retries, rotation and
restore. PostgreSQL tests separately cover revocation during provider waits and lease
expiry while an installation lock or object write blocks.
