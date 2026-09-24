# Guided recovery from a Cloud snapshot

Continue the authorised local integration sequence. An owner should recover a failed
venue server through the replacement's setup wizard and their Cloud account, without
copying storage credentials, public keys or recovery keys. Existing Waitron documents
make the boundary explicit: use cold restore only when no surviving server has newer
data; Cloud authorization does not fence a running box or establish permission to trade.

## First supported path

Support verified retained snapshots for test venues. Prefer the latest verified point,
show its capture time and the loss of later changes, and allow selecting an older verified
point. Continuous server recovery and planned final-write handover remain unavailable
until Waitron's slice-2 contract is ready. Do not label a SQLite-only stream restore as a
complete server rebuild. Existing local-file restore stays available.

On the replacement, choose Restore from Waitron Cloud. The server creates a fresh private
Ed25519 key, a request ID and a matching code in its private local state; the browser sees
only the code, expiry and Cloud link. In Cloud, sign in, choose the venue/snapshot, enter
the code and confirm that the old server and any surviving peers are stopped and that
changes after the displayed time will be lost. The grant binds the exact snapshot and
fresh target key. A lost approval reply can be reconciled without changing that binding.

Back on the replacement, check the approved snapshot and explicitly start local restore.
The target proves its key to fetch metadata, then obtains short-lived read authority for
that one object and its archive key. Neither the Cloud browser nor the local browser sees
keys or storage credentials. The server checks size and digest before staging the artifact
through Waitron's existing validated restore/restart path. Waitron performs cold restore,
module hooks and its existing activation checks. Cloud never changes routes or enrols a
replacement in response to an authorization or a target progress report.

## Authority and failure handling

Use a separate signed request namespace bound to origin, action, request ID, key, code and
fresh timestamp. Store only a code hash in Cloud; bound expiry and failed matching attempts.
Only a live owner session with origin/CSRF proof can inspect and approve a request. Keep
approval and BackupRecovery.start in one transaction; trace and preserve lock order.
Persist the existing operation identity before any external call. Retries cannot bind a
new point, account or target. Refuse previously used installation/recovery keys.

New read grants recheck live owner permission, target proof and operation state after the
storage-authority wait. Return only the archive key, never the continuous-stream key.
Already issued read credentials can last up to fifteen minutes; closing an operation stops
new grants but cannot recall data or keys already downloaded. No arbitrary endpoint or
URL supplied by a browser is fetched. The appliance uses its configured Cloud origin and
only Cloud-authorized HTTPS storage. Bound request, response and transfer sizes/times.

The account page shows authorization, expiry and cancellation separately from local restore
completion. Do not report restored merely because download or staging finished. Keep local
restore progress truthful across restart and lost replies. Private request state stays out
of captured archives. A busy or non-fresh replacement refuses destructive restore through
existing Waitron setup and venue-lock checks.

## Proof

Use real database tests for pairing-code limits, exact retries, cross-owner/venue isolation,
expiry, concurrent cancellation, revoked permissions during storage waits and single-object
read grants. Use real bilingual Cloud and Waitron setup browser tests with lost replies.
Extend the local backup proof to follow owner HTTP approval and the actual Waitron target
client, download using scoped storage, then run Waitron's real restore validation/hooks with
sources stopped. Verify venue contents, excluded Cloud keys, wrong-key refusal and no
Cloud enrolment/routing mutation. Finish and land both repositories autonomously.

## Implemented wire contract

Machine POST routes under `/api/recovery/` reject browser Origin headers and accept
canonical base64url payload/signature pairs. `start` and `status` sign the JSON array
`["waitron-cloud-recovery-request-v1", origin, requestId, action, publicKey, code, issuedAt]`.
The timestamp is milliseconds and must be within sixty seconds; the UUID, fresh
Ed25519 SPKI key and eight-digit code remain bound across retries. The response contains
`requestId`, `state` (`awaiting_owner` or `approved`), `expiresAt` and nullable `operationId`.

`info`, `read` and `restored` also send `id` and sign
`["waitron-cloud-recovery-v1", origin, id, action, digest, issuedAt]`.
For `info`, the digest is empty; its response contains approved point metadata and
`operationExpiresAt`, without keys or a storage location. `read` binds the approved
digest and returns that point, its location, archive `recoveryKey`, operation expiry,
and temporary single-object credentials with their expiry. `restored` returns only a
status acknowledgement. Waitron may call it only after the actual cold restore succeeds.

Owner POST routes `/api/account/recovery/{inspect,approve,close}` require the exact
portal Origin, live session cookie and CSRF header. All accept string `requestId` and
`code`; approval also requires `pointId`, `oldServerUnavailable:"true"` and
`acceptDataLoss:"true"`. Only unapproved requests use the five-attempt code lockout,
so later typing errors cannot prevent the authenticated approving owner from closing
access. Global IP, machine IP, proven-key and account limits apply independently. Unapproved
request and operation expiry use the database clock; signature freshness uses the
signed timestamp. Only snapshot records can be approved or downloaded.
