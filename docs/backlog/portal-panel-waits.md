# Recovery and remote browser waits (D530)

[PR #877's first CI run](https://github.com/waitron-io/waitron-cloud/actions/runs/41440510102/job/125260999361)
timed out twice: the Spanish recovery journey could not find its initial code
field within four seconds, and the English remote-name journey finished clicking
Review but exceeded three seconds waiting for scheduled navigation. The failures
occurred in dark mode at 390 pixels. Neither identifies a cause.

Both unchanged browser files pass all 88 cases on the Linux test box, including
the affected language, theme and width combinations. Earlier native and concurrent
controls also pass. These results do not reproduce or repair either CI failure.

If either journey fails again, you get its named step and the last 100 browser
events. Static endpoint names distinguish requests, response headers, completed
requests and failed requests for sessions, installations, backups, recovery and
remote-name operations. Main-frame page changes record only Account, Recover,
Login or an `other` marker; they do not identify a pending navigation. Response headers do not prove body completion or that
the controller accepted the reply. A missing completion does not identify the
browser, interception or server as the cause.
History and fragment updates can also emit these page-change events; an event
does not prove a reload.

The snapshot records the current allowlisted page and session state, recovery
pending/uncertain flags and whether a code and view exist, remote pending/change
flags and whether a view, confirmation and error exist, and installation loading
flags. It omits codes, identifiers, hostnames, query strings, fragments, bodies,
cookies, headings and raw errors. Unknown flags have an unavailable marker.
Each panel is read separately, so a throwing panel getter does not erase the
session, usage or other panel evidence. Presence flags mean the current controller
field is defined; they do not validate its value. Real-controller controls check
inspection, a refused preview, confirmation and installation loading to catch
field changes that would make those flags misleading.

Reporting has a separate 250 ms timer after the original failure. A closed,
unresponsive or throwing page produces an unavailable snapshot. A failed reporter
keeps the original exception. Scheduling can return later than the timer budget.
Browser launch and page creation failures before tracing starts have no snapshot.
All original assertions and the three- and four-second page limits remain.

Run `pnpm --dir apps/portal exec node --test test/portal-panel-evidence.test.ts
test/portal-failure-evidence.test.ts` for reporting, redaction and budget controls.
The adjacent `recovery-guidance-browser.test.ts` and
`remote-unchanged-name-browser.test.ts` exercise the real portal with stubbed HTTP.
Forced session refusal and DNS-preview refusal controls qualify both journey
catch boundaries; they do not reproduce the historical cause or qualify server
authority.

**Open:** capture a diagnostic recurrence, reproduce its recorded boundary, then
fix the proved cause without changing the existing checks or deadlines. Do not
repeat the passing baseline without a new diagnostic lead.

## Owner handover enrolment wait

On 17 November, [PR #1282's portal job](https://github.com/waitron-io/waitron-cloud/actions/runs/44182558014/job/134390665646)
timed out at `owner-transfer-browser.test.ts:119` waiting eight seconds for
`.factor-codes`. The case passed on the previous PR head, and only three
remote-access test files changed between heads. Its unchanged journey also
passed all eight language, theme and width combinations on the Mac.

The fixture submits `actionTestTotp(secret,-1)`. In a disposable browser probe,
holding only its activation request for 2,479 ms across the next thirty-second
code boundary produced HTTP 403 and the same page-wait failure. No clock,
assertion, deadline or production source changed. This demonstrates a timing
weakness in the fixture; the original CI response was not retained, so it does
not establish that run's cause. The Mac result does not qualify Linux. Keep the
enrolment, session, membership and explicit acceptance checks when changing the
fixture.

On 19 November, [PR #1313’s portal job](https://github.com/waitron-io/waitron-cloud/actions/runs/44443554874/job/135290208342)
reported the same wait for `.factor-codes` at `owner-transfer-browser.test.ts:119`.
The handover test and its authenticator code match the pairing branch’s base
commit. The job log gives no activation response to compare with the timing probe.

[PR #1318’s portal job](https://github.com/waitron-io/waitron-cloud/actions/runs/44477827768/job/135402680094)
hit the same eight-second wait on 19 November. The payment startup branch
changes neither the portal package nor the account and registration packages
used by this fixture. The failed run again has no activation response.

[PR #1320's portal job](https://github.com/waitron-io/waitron-cloud/actions/runs/44513881789/job/135525039664)
hit the same eight-second wait at line 119 and passed 1,469 other tests. The
test and its runner inputs match the preceding main revision. The case passed
in PR #1319's standard CI. The failed job did not record an activation response.

[PR #1321's portal job](https://github.com/waitron-io/waitron-cloud/actions/runs/44530811170/job/135583527533)
hit the same wait and passed the other 1,469 tests. Its activation response was
unavailable too.

On disposable Linux, holding activation for 2,958 ms across the next code
boundary returned HTTP 403 and reproduced the eight-second wait on main.
With the updated fixture, the same probe held activation for 2,960 ms across
the boundary. It returned HTTP 200, and all eight language, theme and width
combinations completed the handover.
The fixture sets its clock two minutes behind database time so a code check
that falls back to live time fails. The authenticator setup and proof deadlines
use that same test clock. PostgreSQL records three distinct code steps for
enrolment, sign-in and handover proof. The session checks still read the live
clock.
Run `node scripts/test-postgres.mjs exec node --test --test-timeout=120000
apps/portal/test/owner-transfer-browser.test.ts` after building the portal.

If the CI wait returns, capture the activation response to identify its cause.

## Owner recovery enrolment wait

[PR #1284's portal job](https://github.com/waitron-io/waitron-cloud/actions/runs/44200297572/job/134452537917)
and [its merge job](https://github.com/waitron-io/waitron-cloud/actions/runs/44204279476/job/134466278119)
exceeded six seconds waiting for Account after adding a passkey. Neither saved
the proof-status response. The unchanged Linux journey passed between failures.

Holding its initial proof-status reply reproduces the same wait: `ensure()`
returned false while its own status read was pending, discarding the enabled
click. It now awaits that read, retaining account fencing and server permission
checks. The deferred-read controller case and the real recovery journey fail
before the fix and pass after it with the original six-second deadline. Run
`node --test apps/portal/test/account-action-proof-controller.test.ts` and the
portal's `test/owner-recovery-browser.test.ts` through the PostgreSQL wrapper.
This fixes the reproduced race; the original CI response remains untraced.

[PR #1293's portal job](https://github.com/waitron-io/waitron-cloud/actions/runs/44250866011/job/134621079335)
and [PR #1294's portal job](https://github.com/waitron-io/waitron-cloud/actions/runs/44251418394/job/134622955872)
hit the same wait after #1288. The logs contain neither the request order nor
runner load. On Linux, the same browser test passed when the list returned first.
With proof first, the late list returned HTTP 200 and the browser sent no enrolment
request before the six-second deadline. The accepted click now waits for the
current list to finish. The proof-first test passes within its original deadline,
and the controller test checks that an account switch discards the old click.
The browser test reports request timing, status, navigation and runner load on
failure, using static paths and stage names.

## Changed-email sign-in wait

Two CI jobs timed out waiting five seconds for sign-in after the email
confirmation click. The logs lack the request order needed to attribute either
failure. [First portal job](https://github.com/waitron-io/waitron-cloud/actions/runs/44204279476/job/134466278462).
[Second portal job](https://github.com/waitron-io/waitron-cloud/actions/runs/44897437907/job/136826078589).

A focused Linux probe held the session check after opening the email link in the
same tab. When the check returned between pointer-down and pointer-up, the list
request disabled the button and the browser sent no confirmation. The browser
regression in `apps/portal/test/account-security-browser.test.ts` holds those two
reads and checks that confirmation stays disabled until it can accept the click.
The five-second sign-in check remains. If the wait returns, use the trace to see
whether confirmation reached the server and whether the next session read signed
the account out.

Sign-out and session-revoke controls still have the window before the session
check. They are outside the email confirmation fix.
