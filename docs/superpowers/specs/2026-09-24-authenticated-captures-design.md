# Authenticated snapshot delivery

Connect an already paired Waitron test installation to Cloud's existing snapshot
catalogue. Keep uploads direct to object storage and separate upload completion from
trusted restore verification. This is local integration; scheduling and recovery UI
remain separate tasks. The owner authorised autonomous implementation, review and land.

## Contract

Add `backup-reserve` and `backup-publish` actions to the canonical machine-v1 envelope.
POST each to `/api/installations/<action>`, with no browser Origin. The operation UUID
is the capture UUID. Reserve signs body `{}`; publish signs the existing PointMetadata
JSON. Both need a valid control lease bound to the installation, venue, environment
and stored public key. Existing installation/IP limits apply. The server selects all
storage paths and key versions; clients cannot supply a venue or destination.

Reserve returns the capture ID, installation and venue IDs, key version, location,
incoming key, archive recovery key, temporary upload credentials and expiry. Never
return stream keys or operator credentials. Repeating reserve renews upload credentials
for the same capture and archive key, including after rotation. Each capture expires
24 hours after creation. Storage credentials last at most 15 minutes; revocation
stops new authority but cannot withdraw credentials already issued by storage.

Publish verifies uploaded bytes against size/digest, saves the retained immutable copy
and returns bounded public metadata. An exact retry returns the existing point; changed
metadata conflicts. Publication does not mark a snapshot verified. Secret responses
are no-store and never enter the installation operation-result table.

## Authority and failure handling

Keep the existing installation-then-backup-location lock order. Check signatures,
lease expiry, test environment and configured retained-snapshot service while these
locks are held; check again after storage waits before committing publication.
Obtain provider credentials outside the transaction, then repeat the locked capture
and authority checks before returning them. Refuse an expired/invalid provider grant.
The HTTP adapter is disabled unless the operator configures the issuer, master key,
storage endpoint and temporary-credential authority. Pin endpoints/regions before
sending operator credentials or signed storage tokens.

Waitron uses its saved installation key and current lease. The client accepts only
responses bound to its installation/capture, verified HTTPS storage destinations and
bounded keys/credentials. It refuses redirects and oversized responses. Upload retries
may receive object-exists: proceed to Cloud publication, which checks the bytes rather
than granting read access to upload credentials. The caller retains the same capture
UUID, archive bytes and metadata across a retry. Capture scheduling and durable archive
spooling belong to the next task.

## Verification

Real PostgreSQL tests cover HTTP authentication, lease expiry after lock waits,
revocation during provider waits, cross-venue capture IDs, rotation, expiry, conflicting
publication and secret-free operation history. Waitron client tests cover binding,
HTTP refusals, timeouts/aborts, upload retries and invalid grants. Update the existing
two-Waitron/S3 local proof to use the new client and HTTP endpoints, preserving real
restore, isolation and missing-stream assertions. Finish and land Cloud and Waitron
branches separately with current-head CI and one isolated run-it review each.
