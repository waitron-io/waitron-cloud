# Receive box error reports and read version holds

You can rehearse Cloud's receiver with signed synthetic reports from registered
installations. Waitron's opt-in setting, sender, offline queue and updater are still
separate work under A1048. Nothing sends reports automatically or deploys this
service. The contract follows [monitoring section 10](superpowers/specs/2026-10-24-cloud-monitoring-alerting-status-design.md#10-error-reports-from-boxes).

Run the signed route and database cases with Node 26, pnpm 9.15.0 and Docker:

```sh
node scripts/test-postgres.mjs exec node --test packages/account-http/test/box-error-reports.test.ts packages/registration/test/box-error-reports.test.ts
```

The fixtures create their own PostgreSQL schemas and installation keys. They submit
reports through the account application's real routes, inspect stored counts and
read the resulting holds. They send no real email or provider requests.

## Send a report

POST `/api/installations/error-report` with the existing installation envelope
`{"payload":"…","signature":"…"}`. Its signed action is `error-report`, its origin
is the account service's configured origin, and its lease is current. The body is
compact JSON with exactly these fields:

```json
{"code":"storage.disk_full","source":"packages/storage/src/archive.ts#write","version":"1.10.0","time":1700000000000,"count":3,"logs":[{"level":"error","code":"storage.disk_full","source":"packages/storage/src/archive.ts#write"}]}
```

The response is `{"accepted":true}`. Registered free installations qualify. Cloud
checks the current installation key, venue, environment, lease and revocation under
locks. The installation comes from the signature; the body has no venue name or ID.
An identical operation ID and body counts once, including concurrent deliveries.
A changed body under that ID returns HTTP 409 with `{"error":"conflict"}`.

`count` is an incremental batch count from 1 through 1,000,000, and `time` is the last
occurrence in that batch, in Unix milliseconds. It can be old for an offline batch,
but cannot exceed Cloud's current time by more than 60 seconds. Do not resend the
same occurrences under a fresh operation ID. Renew the signed request for a retry
without changing its operation ID or body.

Codes use lowercase letter/digit/underscore components separated by dots, up to
128 characters, matching Waitron's declared codes. Sources are relative code paths
with an optional `#function`, up to 160 characters. They allow ASCII letters,
digits, underscore, dot, dollar and hyphen; absolute paths, parent/dot segments,
empty segments, URLs and backslashes are refused. Versions are stable numeric
`X.Y.Z` with no leading zeros and components at most 2,147,483,647. This is the
contract for A1048 to adopt, including the report fields and source grammar;
prereleases and a release catalogue are outside this receiver.

Logs contain at most eight objects with exactly `level`, `code` and `source`.
Levels are `debug`, `info`, `warn` and `error`. Cloud refuses log text, details,
unknown fields, duplicate keys and noncompact JSON. The signed body is bounded at
4,096 bytes. Real masked text waits for Waitron's sender and its A980 O9 masking.
Identifier syntax cannot establish that a sender used an honest code or source;
never put private content in either. Stored reports have no AI consumer.

The receiver stores each report and its logs separately. Group by error code and
version, summing `occurrences` and taking the minimum/maximum `reported_at` for
batch times. A moved source stays the same error. Each row keeps its authenticated
environment, so test reports cannot become production history if a venue changes
environment. Accepted reports remain after revocation; revoked installations cannot
submit or read. Reports and held reads write neither customer usage operations nor
installation contact times.

## Read whether a version is held

POST `/api/installations/release-held` with action `release-held`, the same signed
credential rules, and body `{"version":"1.10.0"}`. The response is exactly
`{"version":"1.10.0","held":true}` or the same object with `held:false`; it exposes
no installation IDs, reports or log samples. This query writes no operation row.

Within the caller's authenticated environment, Cloud chooses the greatest numeric
lower version reported by at least two installations. Without that predecessor,
or without reports for the requested version, the answer is false. With one,
Cloud holds an error when at least two installations reported it and its total
count is at least five. A code absent from the predecessor then qualifies; an
existing code must also have at least twice the predecessor's count per reporting
installation. The denominator is all installations reporting any error in that
version. Both numerical boundaries are inclusive. One database statement reads the
comparison, and later predecessor reports can change the result. The query first
chooses a qualifying predecessor, then aggregates only those two versions through
an index that also holds the fields needed for counting. Reports within either version still contribute to read cost.
The query skips the comparison when the requested version has no reports, and
skips that version's reports when no earlier version qualifies. The numerical
hold rule stays the same.

These are lifetime counts from error-reporting boxes. Older versions have longer
to accumulate errors, which can delay a hold on a young release. Fixing other
errors can shrink the denominator and inflate the remaining error's ratio; wider
mild failures can remain hidden. Two installations can belong to one venue, and
one box can supply most occurrences. Supplied versions are signed claims, not a
release catalogue. A false answer proves no fleet health or release safety. Assess
matched-window error shares once real reports exist; the current rule has only
synthetic evidence.

Reports allow ten requests per minute per installation, held reads thirty, and the
two routes together sixty per IP. These use separate scopes from renewal's
installation allowance. Every request still shares the account API's 120-per-minute
IP limit. Batch counts rather than sending once per occurrence. At the report
limit, payload growth is bounded at 14,400 × 4,096 bytes per day per installation,
before database overhead; this is not a production capacity qualification.

Paging, the investigator, release waves, Waitron's staff problem-report form and
its sender/updater remain separate work.

## Receive a staff problem report

You can receive structural error attachments before an administrator sends a
description. An unsent draft stays on the box. Cloud does not enforce the box's
administrator role; Waitron's sender must send typed text only after that
administrator sends it. Staff submissions need no automatic-error opt-in.

POST `/api/installations/staff-report` with exactly `payload`, `signature` and
`body`, all strings. Sign action `staff-report` using a current installation lease.
The external `body` string contains JSON like this:

```json
{"version":"1.2.3","time":1700000000000,"logs":[{"level":"error","code":"storage.disk_full","source":"packages/storage/src/archive.ts#write"}],"details":{"device":"till","equipment":["printer"],"upgradedAt":null,"hosting":"unknown"}}
```

The signed machine body contains `{"version":1,"bodySha256":"…","bodyBytes":123}`.
Compute the SHA-256 hex digest and byte count from the exact UTF-8 external string.
The software version is separate from this fingerprint's schema version. Keeping
the attachment outside the signed envelope preserves the shared envelope limits.
Cloud verifies the digest and replies `{"received":true}` after committing.

Use at most eight structural log objects with the automatic report's code,
source and level rules. Empty logs are accepted. Details have exactly four fields:
`device` is `till`, `dashboard`, `setup`, `server` or `unknown`; `equipment` holds
at most sixteen `printer`, `card_reader` or `other` values; `upgradedAt` is a Unix
millisecond timestamp or null; `hosting` is `hosted`, `on_prem` or `unknown`.
Hosting is an unverified sender claim. Equipment names, serials, addresses and log
text are refused. Timestamps may be old but not over 60 seconds ahead of Cloud.

Include `description` only if the administrator has sent it. Its maximum is 2,000
Unicode codepoints and 8,192 UTF-8 bytes. Malformed Unicode and control characters
are refused, except newline and tab in descriptions. Senders convert Windows
`\r\n` line endings to `\n` before signing, because a carriage return is refused.
The decoded body is limited to 16,384 bytes; the outer request to 65,536 bytes
and five seconds. Unknown fields
are refused. Each staff action has ten requests per minute per installation,
sharing the existing report IP and account IP limits. Renewal is unchanged.

## Attach a description later

POST `/api/installations/staff-description`, signed as `staff-description`, with
the same outer format and a fingerprint of this external `body`:

```json
{"reportId":"00000000-0000-4000-8000-000000000001","description":"The printer stopped after the upgrade."}
```

`reportId` is the original staff submission's operation ID. The description request
has its own operation ID. If the report has not arrived, retry later: HTTP 404
`{"error":"report_not_found"}` inserts nothing. A foreign installation or
environment, or an automatic report, has the same response. A description is
write-once. Retry its identical operation and body for `{"received":true}`;
changed descriptions and operation IDs used by another report action return HTTP
409 `{"error":"conflict"}`. This also applies to concurrent deliveries.

Cloud derives the venue from the authenticated installation. The receiver rechecks
the key, venue, environment, lease, revocation and proof expiry around database
waits. Staff rows never supply automatic error counts or release-hold predecessors.
Neither report kind writes usage operations or contact times, and neither is
automatically deleted. These are local receiver guarantees, not production or
sender qualification. The A1047 sender contract remains provisional.

Run the synthetic loopback HTTP, database wait, migration and owner-reader cases:

```sh
node scripts/test-postgres.mjs exec node --test --test-concurrency=1 packages/account-http/test/staff-problem-reports.test.ts packages/registration/test/staff-problem-reports.test.ts packages/operations/test/staff-problem-reports.test.ts packages/account-http/test/box-error-reports.test.ts packages/registration/test/box-error-reports.test.ts
```

## Measure storage and reads before sizing a service

Run the volume measurement through the throwaway PostgreSQL wrapper:

```sh
node scripts/test-postgres.mjs exec node packages/registration/scripts/measure-box-error-reports.mjs
```

The runner creates and removes its own schema using the real migrations. It loads
1,000 installations, 20 equally represented releases and five error codes with a
60/20/10/7/3 percent spread. The 10,000-row sample has 500 reporting installations;
the larger samples have 1,000. Each report has one source, two structured log
entries and one to five occurrences. Bulk loading includes foreign keys, indexes
and commit time, but excludes signing and HTTP. The runner then submits signed
reports, retries one and reads the latest, first and absent versions through the
real HTTP routes. Each request captures and explains all eight actual reads with
`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`; `BOX_REPORT_COST` contains the full plans.

On 7 November 2026, this command used PostgreSQL 18.6 on the Debian x86 test
box with four CPUs and Node 26.11.1. Sizes below include table overhead and
indexes; one MiB is 1,048,576 bytes.

| Reports | Table MiB | Index MiB | Total MiB | Bulk insert seconds |
| --- | --- | --- | --- | --- |
| 10,000 | 4.38 | 1.70 | 6.09 | 0.607 |
| 100,000 | 43.45 | 16.47 | 59.92 | 6.226 |
| 1,000,000 | 434.18 | 152.05 | 586.23 | 67.088 |

These are PostgreSQL execution milliseconds after `VACUUM ANALYZE`, with cached
reads and no competing requests. Shared lookup rows show the largest observation
across the five request probes; the hold rows show their individual comparison.
Report deduplication includes the duplicate retry. Plans are replayed after the
request commits, so even the first submission's replay finds its stored row.

| Read | 10,000 | 100,000 | 1,000,000 |
| --- | --- | --- | --- |
| Shared IP allowance | 0.128 | 0.066 | 0.104 |
| Error-route IP allowance | 0.116 | 0.062 | 0.062 |
| Installation authentication | 0.097 | 0.061 | 0.056 |
| Installation allowance | 0.111 | 0.074 | 0.062 |
| Installation binding | 0.090 | 0.053 | 0.048 |
| Venue shared lock | 0.117 | 0.061 | 0.060 |
| Installation update lock | 0.113 | 0.071 | 0.057 |
| Report deduplication | 0.102 | 0.046 | 0.052 |
| Latest hold comparison | 4.476 | 34.598 | 342.624 |
| First version, no predecessor | 0.397 | 0.436 | 0.384 |
| Absent requested version | 0.382 | 0.374 | 0.384 |

The original query at commit `4d0eb9a5e` scanned report history even when one
side was missing. At one million reports, the earlier run on the same test box
measured 91.409 ms without a predecessor and 99.024 ms for an absent version;
the final run with both existence probes measured 0.384 ms for each. The latest
comparison measured 325.450 ms before and 342.624 ms after, so these runs
establish no improvement for that case. Its cost still grows with reports in
the two compared versions. The focused test checks that missing comparisons
avoid history scans, including rows that PostgreSQL reads and discards.

Use these as local synthetic measurements, not a production capacity limit or a
concurrent throughput estimate. A different version distribution, longer sources,
eight log entries, cold storage, waiting locks, transport and concurrent writes
can change the result. Table size excludes WAL, backups and replicas. Assess
matched-window error shares after real reports exist; this experiment changes no
retention or reporting policy.
