# Recovery and remote browser waits (D530)

[PR #877's first CI run](https://github.com/waitron-io/waitron-cloud/actions/runs/41440510102/job/125260999361)
timed out twice (Spanish recovery code field, four seconds; English remote-name navigation, three
seconds; dark, 390 pixels). Neither identifies a cause, and the unchanged files pass 88 Linux cases.
A failure now reports its named step, the last 100 browser events and a redacted panel snapshot;
response headers do not prove a completed body, and a page-change event does not prove a reload.

**Open:** capture a diagnostic recurrence, reproduce its recorded boundary, then fix the proved
cause without changing the checks or deadlines. Do not repeat the passing baseline without a new
lead.

## Owner handover enrolment wait

Five CI jobs (PRs #1282, #1313, #1318, #1320, #1321) timed out waiting for `.factor-codes` without
recording the activation response. A code-boundary race in the fixture reproduces the wait and is
fixed; the CI cause is unproved. If it returns, capture the activation response.

## Owner recovery enrolment wait

PRs [#1284](https://github.com/waitron-io/waitron-cloud/actions/runs/44200297572/job/134452537917),
[#1293](https://github.com/waitron-io/waitron-cloud/actions/runs/44250866011/job/134621079335) and
[#1294](https://github.com/waitron-io/waitron-cloud/actions/runs/44251418394/job/134622955872) exceeded six
seconds after adding a passkey. Late proof-status and passkey-list replies are reproduced and
handled; the original CI responses are untraced.

## Changed-email sign-in wait

Two CI jobs ([first](https://github.com/waitron-io/waitron-cloud/actions/runs/44204279476/job/134466278462),
[second](https://github.com/waitron-io/waitron-cloud/actions/runs/44897437907/job/136826078589)) timed out
after the confirmation click; a reproduced disabled-button window is fixed. If it returns, use the
trace to see whether confirmation reached the server. Sign-out and session-revoke still have the
window before the session check.
