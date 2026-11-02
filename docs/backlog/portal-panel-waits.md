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

The snapshot records the current allowlisted page and session state, recovery
pending/uncertain flags and whether a code and view exist, remote pending/change
flags and whether a view, confirmation and error exist, and installation loading
flags. It omits codes, identifiers, hostnames, query strings, fragments, bodies,
cookies, headings and raw errors. Unknown flags have an unavailable marker.

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
