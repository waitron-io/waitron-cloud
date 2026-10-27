# Portal session test startup

A local full portal run during the receipt-selection work passed 195 of 196
cases, but `test/session.test.ts:59` timed out after three seconds waiting for the
initial signed-in screen. Running that file separately passed both cases. The
portal, backend and database harness sources match the preceding main revision;
that comparison does not explain the failure.
Both session cases now trace navigation and their first signed-in wait with
D134's bounded, redacted request events: endpoint, method, status, elapsed time
and browser-error occurrence. A failure adds an allowlisted heading and fake-clock
time; an unavailable page has a 250 ms diagnostic budget after the original wait.
Tokens, cookies, bodies, unexpected headings and raw errors stay out of the report.
`node --test apps/portal/test/session-startup.test.ts` forces a miss and checks
those boundaries, redaction and preservation of the original timeout. The real
portal fixture also forces a 503 startup miss in `test/session.test.ts` on CI.
Every original assertion and deadline remains unchanged. Capture a diagnostic
recurrence before attributing a cause; these diagnostics do not explain the
historical failure.
