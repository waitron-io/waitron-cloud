# Remote health notifications design

## Outcome

The account portal shows whether the public site and staff TLS route passed their latest external check. It distinguishes a failed route, missing or stale evidence, and an expiring certificate from missing installation contact or stale backups. Owners who opt in receive English or Spanish incident and recovery email through the existing encrypted queue.

This remains a local integration. It sends only to Mailpit in the proof and does not configure a live sender or deploy monitoring.

## Portal evidence

The existing installation overview remains the only customer status response. For a current remote-access placement it adds a `remoteChecks` object with one entry for `public` and one for `staff`. Each entry contains only the latest durable probe status, check time and certificate expiry. It excludes hostnames, fingerprints, internal addresses, route credentials and raw errors.

The response also includes the six current remote incident kinds. The portal uses the durable incident state rather than inventing a second freshness threshold:

- an open probe-stale incident, a missing observation or an old overall monitor check is unknown;
- an open route-failure incident is failed;
- otherwise a healthy current observation is shown as recovered or working;
- an open certificate incident shows the verified expiry time separately from route reachability.

The existing session and organisation-membership checks scope the response. A final session recheck remains after the database reads. Switching organisations therefore cannot expose another venue's evidence.

## Alert delivery

All nine monitoring incident kinds use the existing `service_alert` message. Remote messages add optional ISO timestamps for the external check and certificate expiry. They never carry a hostname, fingerprint, probe failure detail or internal exception.

The monitor enqueues a message only on an incident transition. The existing delivery row uniqueness prevents a repeated scan from enqueueing the same revision twice. A recovery goes only to an account whose opening message for the preceding revision was accepted by the transport.

The delivery worker rechecks the current session-independent authority immediately before transport. The account must still be enabled, verified, opted in and an owner of the venue. The installation must still be current and unrevoked. Snapshot incidents require the retained-snapshot service; remote incidents require the remote-access service plus its current placement and hostname. An opt-out, ownership loss, route removal or revocation cancels queued mail.

## Customer copy

English and Spanish portal and email copy names the affected surface as the public site or staff access. It gives the last external check time when one exists. Failure copy suggests checking the gateway, venue internet connection and certificate setup without exposing a private error. Stale copy says the state is unknown. Certificate copy names the verified expiry time and asks the owner to check renewal and installation.

A healthy result after a prior incident is visible as a successful latest check. Recovery email uses the same route-specific label and the new check time. Installation-contact and backup messages keep their current wording.

## Verification

PostgreSQL tests prove remote incident and recovery enqueueing, duplicate suppression, live owner and preference checks, route removal and revocation suppression, and venue isolation. Payload and rendering tests reject unexpected fields and cover every remote kind in both languages.

HTTP and portal tests prove the redacted response shape, stale-to-unknown behavior, failure and recovery presentation, certificate expiry, account isolation and invalid response rejection. Real Chromium covers English and Spanish at phone and desktop widths in light and dark themes. Mailpit proves incident and recovery delivery without sending live customer mail.

