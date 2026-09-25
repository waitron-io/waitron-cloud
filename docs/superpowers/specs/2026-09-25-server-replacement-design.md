# Reconnect a restored server to its Cloud venue

## Intent and scope

Continue the owner's autonomous local integration programme. After guided recovery of a
verified test snapshot, reconnect the replacement to the existing Cloud venue without
copying credentials or asking support to edit database rows. Preserve organisation,
business, venue, retained backups and assigned/custom hostnames. Replace the installation,
not the venue. Waitron keeps authority over local trading and fiscal identity; Cloud's
credential handover does not fence an offline server. Production, planned final-write
handover and complete continuous recovery remain separate tasks.

Use the existing successful managed-restore receipt and an explicit local manager action
on a serving test primary. The replacement persists a fresh Ed25519 installation identity
and fresh WireGuard peer key before sending a request signed by both the recovery target
and new installation. The Cloud owner must separately confirm that the old server is out
of service and approve replacement of the displayed installation. Neither download,
restore progress nor startup alone retires the old installation or changes routes.

## Protocol and persistence

Machine POST `/api/replacement/prepare` and `/api/replacement/status` accept
`{id,payload,signature,keySignature}`. Both signatures cover canonical UTF-8 JSON:
`["waitron-cloud-replacement-v1",origin,id,action,localVenueId,nodeId,"test",publicKey,peerPublicKey,issuedAt]`.
`signature` uses the existing recovery target key; `keySignature` uses the proposed fresh
Ed25519 key. UUIDs, SPKI base64url Ed25519 keys, canonical 32-byte base64 WireGuard public
keys and a sixty-second timestamp window are required. Reject browser Origin, oversized
requests, unknown fields/actions and forged or crossed proofs. Limit IP and proven keys.

Prepare requires the approved verified snapshot's actual restore report, a live original
owner, an unexpired/unclosed recovery and matching local venue/source-node/environment.
Store the exact proposal and current installation binding once. Refuse previously used
installation or recovery keys, reused peer keys and changed retries. A proposal cannot
make any service grant. One active backup recovery already serializes the venue's restore;
record a replacement result separately so recovery closure cannot erase its history.

Owner recovery inspection includes `replacement` (null or the proposal/result). Owner
POST `/api/account/recovery/replace` requires current session, CSRF, original matching
code, `oldInstallationId`, `oldServerUnavailable:"true"` and `confirmReplacement:"true"`.
Only the original approving owner can commit the proposal, with permission and expiry
rechecked after lock waits. Use one PostgreSQL transaction for old Cloud credential
revocation, installation-history link, fresh installation, service configuration, backup
location/key-version handover and remote placement update. Existing old captures retain
their source installation and keys. Rotate the archive key for subsequent captures.
Service health begins unknown; do not copy old observations or lease authority.

Keep one current installation per venue using an explicit supersession link and unique
current-row index; a revoked current installation still prevents ordinary pairing from
silently taking over. Trace every query relying on one installation per venue, including
pairing retries, account overview, monitoring and retention. Keep old rows for history.
Recheck old installation/location binding before commit. Lock order follows existing
request -> account/membership -> venue -> installation -> backup location order; remote
cell updates follow installation locks. Prove conflicting grants and replacement under
real independent database connections rather than assuming locks compose.

Move remote placement to the new installation and fresh peer key, retaining cell/address,
port and both hostnames. Gateway manifests then contain only the replacement; cached
old gateway authority still has the existing ten-minute bound. Old scoped storage grants
may survive until expiry; new snapshot captures use fresh UUIDs and a new key version.
This slice does not automate installing the appliance tunnel or issuing staff certificates:
the existing local operator path tests fresh peer/certificate material, and customer status
continues to show provisioning until those adapters are configured and checked.

## Resuming and customer screens

The complete result binds request, source installation, target keys, local identity and
registration. Exact signed status retries can retrieve it after operation expiry/closure
while the replacement installation remains active, so a lost response cannot strand the
new owner of the venue. They cannot retrieve a revoked/superseded installation result.
A committed replacement cannot be cancelled by closing download access; use the normal
installation stop-access control. Before commit, closing/expiry prevents handover.

Waitron imports the confirmed registration through the existing Cloud connection write
gate, refuses an unrelated pre-existing connection, and checks local manager permission,
serving-primary status and venue identity before and after network waits. The recovery
and candidate private state never enter browser responses or archives. Retry after a
crash between saving Cloud connection state and recording completion must converge on
the same keys and registration. Never fall back to ordinary pairing after uncertainty.

Cloud recovery shows waiting-for-server, waiting-for-owner and completed replacement
states in English and Spanish, with old/new installation context and an explicit warning
that the old server must stay out of service. Waitron's existing Cloud settings screen
provides request/check reconnection with actionable failures and synchronous busy guards.
Completion reports Cloud registration, with remote access/backups checked separately.

## Verification

TDD for each new behavior. PostgreSQL tests cover crossed keys/venues, permissions,
expiry during waits, old-credential grant races, two competing replacements, rollback,
unchanged retries, retained snapshot recovery, one current venue row and fresh service
health. Delete critical guards to check negative assertions discriminate. Browser tests
cover English/Spanish owner confirmation, stale state, lost replies and phone themes.
Waitron tests cover local manager/primary gates, private-state persistence, import retries
and boot integration without altering trading authority. Extend the real local backup
proof through replacement enrolment and renewed new-installation capture, with old
credentials rejected and unrelated venue intact. Verify gateway manifest identity and
stable hostnames with fresh peer material. One isolated review per production branch,
normal hooks and current-head CI, then land and clean both branches autonomously.
