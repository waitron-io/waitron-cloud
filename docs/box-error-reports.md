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
comparison, and later predecessor reports can change the result.

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

Paging, the investigator, release waves, the staff problem-report form and
Waitron's sender/updater remain separate work.
