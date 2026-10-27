# Recovery screen scope and supplied choices (D158)

When you return from Account, recovery now clears a backup selection that is not
one of its offered test venues. Its panel and approval controls independently
check the same offered choices. Changing organisation, losing permission or
removing the venue clears the selected source and both confirmations. Account
can still show production backup metadata.

Recovery's organisation and venue selectors, Account's organisation selector and
pairing's business selector now select their options after those options exist.
The supplied choice, displayed choice and subsequent request agree in the
browser checks. Recovery waits for an installation refresh before changing the
organisation. The pairing regression uses a supplied second business; no normal
journey that preselects that business was established.

The real-server reproduction showed a production backup panel on return. With
continuous data, Approve sent that unoffered venue ID, but the server refused it
with HTTP 403 and stored no recovery row. Snapshot approval stayed hidden because
the production environment invalidated its qualification. Direct Account API
approval was also refused for both sources. Permitted test-venue controls sent
and stored their exact snapshot or continuous source. Capture provisioning and
recovery retain the existing test-only server guard. These are synthetic retained
metadata fixtures, not evidence of production backup provisioning. PostgreSQL
checks run in GitHub CI while Docker is down locally.

