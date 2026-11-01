# Portal lost-reply test ordering

- **Open: new portal failures after the D132 documentation merge.**
  [CI39967649257](https://github.com/waitron-io/waitron-cloud/actions/runs/39967649257)
  at `4e07a98a9dad1073289a76b086073afc36728191`, job120461847149,
  failed the reused-reset-link message at `apps/portal/test/journey.test.ts:57`,
  the lost-reset-reply callback at line89 (`Request context disposed`), and the
  post-reload translation control at
  `apps/portal/test/translation-consent-browser.test.ts:72`. All27 jobs are final;
  the strict summary also refuses the three failed tests. The same source tree
  passed exact-head CI39966740913; matching bytes do not establish a cause.
  D134 adds bounded browser/server request traces: static endpoint, method,
  status, elapsed time and server connection-pool counts, excluding request bodies,
  cookies and reset links. All 104 real Linux test cases passed across
  [the initial trace run](https://github.com/waitron-io/waitron-cloud/actions/runs/39973004321)
  and [the browser/server trace run](https://github.com/waitron-io/waitron-cloud/actions/runs/39973503708).
  The temporary repeat workflow is removed; normal CI retains these traces.
  That does not explain the historical failures. Capture a diagnostic recurrence,
  reproduce its named stage, then fix the proved cause test-first. Every original
  session, ownership, reset, consent, cleanup and timeout assertion remains.
  No product fix or longer deadline is claimed. Real-fixture reproduction runs on
  the shared Linux test box while Mac Docker is off. D530 owns the separate
  consent database-wait diagnosis; Lane G retains its parked branch.

- **Resolved: reconciliation stalled after the reply was dropped.**
  [CI 36777640375](https://github.com/waitron-io/waitron-cloud/actions/runs/36777640375)
  on `ab5161d4af0fc41aad83c99ce22de80035b2e027` failed both English journeys
  at the four-second saved-name wait (portal 110/112). PR #102 subsequently reproduced
  the browser-side stall and retained the apply interceptor through reconciliation,
  as described below. [The fix's exact-merge CI](https://github.com/waitron-io/waitron-cloud/actions/runs/36851962407)
  passed on `3085054b8d82698ec3e8f420ade798957df2d9a8`.
  [PR #103](https://github.com/waitron-io/waitron-cloud/pull/103) includes the fix;
  [its rebased-head CI](https://github.com/waitron-io/waitron-cloud/actions/runs/36855902107)
  passed on `7b5cdb1f50449e4a9c2d50e59f757aa1c1cd8716`.
- The remote-DNS journey waits until its fixture has dropped a successful apply
  reply before starting the four-second saved-name assertion. Previously that UI
  wait also timed the fixture's forwarding and fault injection. A controlled
  4.5-second hold after the committed HTTP 200 reproduced the timeout while the
  browser was still waiting for the reply; the same case passes after the explicit
  injection acknowledgement. The English/Spanish journeys keep every existing
  assertion, and the delayed-injection case guards the ordering. A separate
  30-second fixture deadline fails with diagnostics if interception never completes,
  so the browser and database can close even when the route does not match.
- The failure in [CI 36738638444](https://github.com/waitron-io/waitron-cloud/actions/runs/36738638444)
  predates these diagnostics, so you cannot attribute that historical failure to
  this mechanism with certainty. The test records bounded request/status events,
  injection stages and the setup screen if it fails again. Investigate any new
  failure from that evidence; a passing repeat alone does not establish its cause.
- The bounded Ubuntu probes reproduced the newer status stall in
  [run 36846155539](https://github.com/waitron-io/waitron-cloud/actions/runs/36846155539)
  and [run 36846703454](https://github.com/waitron-io/waitron-cloud/actions/runs/36846703454).
  Both failures followed a committed apply and completed abort. The browser emitted
  the status request, the server never received it, and the database was idle.
  The second probe recorded interception being disabled after the abort. Keeping
  the apply interceptor until the saved-name assertion completes makes the status
  read pass through interception before teardown. Chromium's internal reason for
  stranding the request during teardown remains unverified. The separate delayed
  status control still fails at four seconds, so a genuinely slow read is not hidden.
  [The fixed probe](https://github.com/waitron-io/waitron-cloud/actions/runs/36847208929)
  passed all 18 English, Spanish and delayed-injection journeys; each status read
  was explicitly continued before interception was disabled. Temporary Ubuntu
  workflows, control switches and protocol tracing are removed.


## Usage rate-limit wait (D530)

[PR #598's CI run](https://github.com/waitron-io/waitron-cloud/actions/runs/41183089824/job/124484426019)
failed the translation-consent uncertainty wait after five seconds and the usage
rate-limit wait after four seconds. The consent trace ends with server-received
activity and consent requests without completion. The usage failure lacks that
boundary evidence. You cannot infer a shared cause from their occurrence in one
job. The unchanged usage journey passes all 56 local checks; that does not repair
or explain either historical failure.

When a usage page wait or setup step fails, you now get its named stage, the browser's last
100 static endpoint events, and a controller snapshot: pending, loaded, an
allowlisted error, remaining wait, and whether an organisation and earlier totals
are present. Session reporting includes only its state. Query strings, bodies,
account and organisation identifiers, headings and raw errors are omitted. A
response event records headers; a finished event records request completion.
Neither proves that the controller accepted the body. A request with no response
does not identify the browser, interception, network or server as the cause.

Node reports failed subtest assertions separately; those failures do not enter
the journey's catch handler and do not get this snapshot.

The snapshot has a separate 250 ms timer budget after the original failure. A closed
or unresponsive page produces an unavailable marker. A reporting failure retains
the original error, including an immediate snapshot throw. A controlled clock
checks the timer at 249 and 250 ms; real scheduling can return later. Every existing usage assertion, four-second page wait,
61-second simulated cooldown advance and two-minute test deadline remains.
Run `pnpm --dir apps/portal exec node --test test/portal-failure-evidence.test.ts`
for controlled lifecycle, redaction and reporting failures, and the adjacent
`test/usage-read-message-browser.test.ts` for the full usage journey.

**Open:** capture a recurrence, reproduce its named request/controller boundary,
then fix that cause without changing the original checks. Consent's unfinished
server requests need a separate real PostgreSQL reproduction. These synthetic
HTTP diagnostics do not qualify server authority or repair the historical waits.


## Consent database waits (D530)

The consent failure above reaches the server without recording request completion.
If the journey fails again, you now get a separate database snapshot before fixture
cleanup. It uses its own connection because the application pool may be full.
You see up to 20 connections from that fixture, with lock waiters first: database
state, wait type, blocker count and a fixed session, consent, idle or other query
family. Query text stays inside PostgreSQL. No query values, connection strings,
process IDs or account identifiers enter this report.

The snapshot has a separate 250 ms timer budget covering connection setup and the
query. A failed connection or unanswered database produces an unavailable marker
and closes that connection. A completed snapshot also closes its socket without
waiting for a disconnect acknowledgement. A failed reporter or a database transport error retains the original test error.
Scheduling and connection teardown can finish later than the timer. The original
five-second page wait and every existing assertion remain.

Run `pnpm --dir apps/portal exec node --test test/consent-failure-evidence.test.ts`
for refused and stalled connections. Run `node scripts/test-postgres.mjs exec pnpm
--dir apps/portal exec node --test test/consent-database-evidence.test.ts` for real
PostgreSQL lock waits, a full application pool and exclusion of another fixture.
These controls qualify reporting, not the historical cause or server authority.

**Open:** capture a recurrence and reproduce the recorded request or database wait
before changing runtime behavior. Query families are coarse text classifications;
they inspect only the stored statement text and use the first matching family.
They do not identify a complete transaction. The sample can omit connections beyond
its limit, and an unavailable snapshot cannot distinguish a database outage from
a slow diagnostic connection.
