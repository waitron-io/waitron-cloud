# Read the AWS storage rehearsal narrowly

The local object-store proof cannot establish how Amazon S3 handles real temporary
credentials, encryption settings or competing writes. A one-day sandbox rehearsal on
14 October 2026 exercised those boundaries in Europe (Stockholm), `eu-north-1`, with
synthetic data. It also restored a real Waitron archive and a Litestream copy of a
Waitron database into disposable local targets.

The [recorded evidence](receipts/aws-storage-2026-10-14.json) identifies the tested
Cloud and Waitron revisions, configuration, results and cleanup. Repeat the
deployment checks in Spain before making any Spain-location or production recovery
claim.

## Separate storage permission from account recovery

The rehearsal created one private, versioned S3 Standard bucket, one tagged symmetric
KMS key and two temporary IAM roles. A role is an AWS identity that issues temporary
credentials. Each role retained the owner's `lane-d-boundary` permissions limit and
had a read-back policy for one venue prefix and the named KMS key. KMS use was
restricted to S3 and that prefix's encryption context. Public-access blocking stayed
enabled. No account permission or shared boundary was changed.

The operator used the externally supplied `waitron-rehearsal` profile. Venue
credentials came from ordinary `sts assume-role` calls with 900-second sessions.
Credentials and encryption keys are absent from the published evidence. No Cloud
web-identity exchange, public deployment or customer mail was involved.

| Probe | Observed result |
| --- | --- |
| Each role reads, writes and lists its own prefix. | Succeeded; default-encrypted objects identified the named KMS key. |
| Cross-prefix read, write, delete, list and version list; listing without a prefix. | Refused with HTTP 403 for both roles. |
| Eight simultaneous create-only writes. | Exactly one succeeded; all other calls returned 409 or 412. |
| Eight replacements using the same previous object tag. | Exactly one succeeded; all other calls returned 409 or 412. |
| A later write using the stale tag. | Refused with HTTP 412; the accepted replacement remained current. |
| Read an earlier version after replacing and deleting the current object. | Earlier bytes remained readable by version ID; the current read reported no object. |
| Upload one 5 MiB multipart part, interrupt before completion, then abort. | No complete object appeared; abort removed the unfinished part. |
| Revoke an existing role session, then issue a fresh session. | The old session lost access; the fresh session read the same object. |
| Wait for a real 900-second session to expire. | The same credential worked before expiry and returned `ExpiredToken` with HTTP 400 afterward. |

Revocation used a role policy denying sessions issued before the recorded cutoff.
This proves the observed refusal, rather than an instantaneous revocation promise
for a deployed service.

## Enable the encryption mode the existing stream needs

The first `BackupObjects.put` using customer-provided server-side encryption, SSE-C,
was refused because the new bucket blocked that mode. AWS changed this new-bucket
default in April 2026. Its [SSE-C setup instructions](https://docs.aws.amazon.com/AmazonS3/latest/userguide/specifying-s3-c-encryption.html)
require deliberate enablement.

Only the disposable bucket was updated. Default KMS encryption and disabled bucket
keys stayed the same; its encryption rule added:

```json
"BlockedEncryptionTypes": { "EncryptionType": ["NONE"] }
```

`get-bucket-encryption` confirmed the setting. Afterward the continuous stream
uploaded and restored with its correct customer key. Reads without that key, or with
the older wrong key, were refused. A provider provisioner for the current stream
format must explicitly configure and verify this setting.

## Restore data before treating an upload as a backup

The archive probe used the existing Cloud `BackupCatalogue` against real PostgreSQL
and `BackupObjects` against S3. A fixture adapter placed catalogue paths below the
authorised venue prefix. It did not change production code. The probe published a
real encrypted Waitron archive at key version 1, called `BackupCatalogue.rotate`, and
observed version 2 for a new capture. Renewing the original capture still returned
its version-1 keys.

The catalogue's verification callback downloaded the retained archive from S3 and
ran Waitron's existing restricted restore fixture with the retained version-1 key.
The restored database passed integrity checks and its restore hook ran. Cloud
credentials, staff TLS keys and the old backup destination were absent. Trying the
version-2 recovery key against the older archive failed and left the database absent.
The catalogue marked the correctly restored point verified.

Pinned Litestream 0.5.17 streamed a copy of the real fixture's Waitron database using
the AWS session and version-2 stream key. After the first LTX data file appeared,
the probe changed the venue name and required a new LTX file before stopping the
writer. It then restored a fresh database from the stored generation. SQLite
integrity and the exact changed venue name matched. This exercised storage and local
restoration; it performed no Waitron activation or Cloud guided-recovery journey.

The existing managed-stream interface carries an access-key ID and secret without a
session-token field. Ordinary AWS assumed-role credentials also require a session
token. A real PostgreSQL `ManagedStreams.configure` probe refused a provider response
containing `sessionToken` with `backup.storage_grant`, left no stream binding and
accepted the two-field control. The rehearsal supplied the token directly to the SDK
and Litestream process. Cloud owns the production adapter follow-up and must coordinate its credential
contract with Waitron before a deployment rehearsal. The deployed web-identity path
also remains unqualified.

## Bound the run and remove its resources

Before resource creation, the AWS Pricing Calculator was configured for Stockholm:
2 GB stored for a full month, 10,000 writes, 10,000 reads, 2 GB downloaded to the
internet, one KMS key for a month and 30,000 symmetric KMS requests. The saved output
totals **US$1.37 before tax**, conservatively exceeding the run's planned storage
duration and 10,000-request KMS allowance. It applies no free-tier credit. Optional
paid logging, compute, DNS and email were absent.

The authorised limits were one day, 1 GiB including retained versions, 1,000
objects/versions, 10,000 S3 requests and 10,000 KMS requests. The receipt records
stored bytes and versions before cleanup. The direct storage probe counted its
requests; restore probes used bounded loops and timeouts. There was no account-wide
request meter. The calculator result is an estimate, not a measured bill or an
automatic spending stop.

The account's charges were **not read**. Billing access had been denied and the owner
waived that receipt. No claim about actual charges follows from the estimate.

Cleanup aborts unfinished uploads, removes every version and delete marker in the
owned bucket, then removes that bucket and only its two roles and inline policies.
The tagged KMS key is scheduled for deletion with the minimum seven-day waiting
period. Read-back confirmed `PendingDeletion`, scheduled for **21 October 2026 at
01:02:09 CEST** (20 October at 23:02:09 UTC). Verify final deletion after that date.
Foreign resources are outside this cleanup. Fixture processes, local databases
and temporary keys are removed after the probes.

Before repeating the rehearsal, obtain fresh authority for the same bounded scope,
price it again, use new unique names and read back the exact policies. Keep the real
session-expiry check and both restore controls. Production still needs Spain-region
qualification, managed credential delivery and revocation, web identity, secret
custody, retention, monitoring, the recovery journey, final-write handover and safe
activation. Google Cloud needs its own provider proof.
