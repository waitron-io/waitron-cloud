# Installation renewal accepted during owner revocation

The owner-revocation test accepted a renewal instead of refusing it as `revoked`
in runs `39953541488` (PR #316), `40990452819` (PR #750) and `41266766013`
(PR #835). The last recurrence observed the revocation statement waiting on the
held installation, then received a renewal with `revokedAt: null`.

A controlled Linux reproduction pauses that waiting PostgreSQL backend, releases
the holder and starts renewal. Renewal acquires the row before the paused backend
wakes, reproducing the existing missing-refusal assertion. A separate single-row
experiment reproduces the same ordering. Forty ordinary installation runs and
1,000 ordinary single-row iterations pass; they do not exclude this scheduling.
The historical runs did not capture backend scheduling, so their exact timing
remains unattributed.

Wait for both requests before releasing the holder. The test first observes
revocation blocked by its own connection, then observes renewal blocked by that
revocation backend. This puts renewal in the row-lock queue before the holder
can release it. It retains the session-wait exclusion, expected `revoked`
refusal, security, venue, service and audit assertions, and existing deadlines.
Production locking and authority are unchanged. Cleanup releases the held
connection and collects both requests when an ordering check fails.

The controlled pause passes with the second queue observation, fails the original
`revoked` refusal when that observation is removed, then passes after restoration.
All 14 installation tests pass. All 97 original assertion expressions and the
existing deadlines remain unchanged. Forced observation failures before and
after renewal starts exit naturally with cleanup; without cleanup, the first
control requires its recorded process group to be stopped after ten seconds.
That stopped control is failure evidence, not a natural exit.

The controlled pause requires only the disposable test database's own backend.
It simulates a scheduler delay; it does not establish a deployed vulnerability
or qualify a general production request-order guarantee. Use the authorised
Linux test box for database checks while the Mac's Docker is off.
