# Mail capture investigations

## Portal reset-mail boundary reporting

The authenticator journey's [missing reset email](https://github.com/waitron-io/waitron-cloud/actions/runs/40398829746)
still needs a causal fix. A 202 response and the confirmation screen do not prove
that Cloud queued or delivered a message. On a missing message, the portal fixture
now reports the queue states, worker results, SMTP acceptance or rejection, and
inbox subjects and synthetic recipients. Bodies, reset tokens, message IDs and
raw errors stay out. The fixture reuses Account HTTP's bounded mail observer and
keeps the original single lookup, recipient match, assertions and deadlines.
Capture a recurrence with this evidence before changing delivery or inbox capture.
Controlled HTTP and database checks verify the reporting independently.
All four monitoring lookups and five signup/recovery lookups now pass their own
fixture's evidence callback, as the authenticator lookup already does. This
includes the [Spanish recovery-mail miss on PR959](https://github.com/waitron-io/waitron-cloud/actions/runs/42096811129/job/127489056104).
Previously those callers reported inbox metadata alone. Controlled empty-inbox
calls execute all ten lookup expressions: the nine unwired callers first fail
for missing queue evidence, then all ten report queue, worker and SMTP evidence.
The original helper checks still cover redaction, successful reads and unavailable
diagnostics. These checks do not reproduce the missing delivery. Capture a natural
recurrence with the callback before choosing a delivery fix; a shared cause with
the venue-service receipt's unsent queue row is unproved.

## Account HTTP reset-mail capture

[CI run 39730254198](https://github.com/waitron-io/waitron-cloud/actions/runs/39730254198)
on documentation-only `ea288eafac4bf7e8fafe5592fb3d81f0afecc7bf` passed 180 of 181
account HTTP shard-3 tests. Its signup/recovery journey could not find the reset
message in Mailpit (`packages/account-http/test/account-http.test.ts:50,90`).
The runtime, fixture and workflow paths are unchanged from main `9701cd2`.
The local unmodified shard command below passes all 181 tests, including that
journey. This does not explain the CI failure or prove a fix. Preserve the assertion and deadline.
The journey now records each worker result and SMTP handoff outcome. A missing
message or token adds queue states, attempt and failure counts, delivery codes and
Mailpit status and match counts to its assertion. Only known states and counts
leave the helper; recipients, tokens, message IDs, payloads and raw errors stay out.
`node --test packages/account-http/test/mail-capture.test.ts` forces misses and
checks the four boundaries, redaction, SMTP rejection and unavailable queue reads.
The original assertions, single lookup and deadline remain unchanged. Capture a
recurrence on Linux before deciding whether delivery or capture caused the
historical failure; these diagnostics do not explain it.

```sh
node scripts/test-postgres.mjs exec pnpm --dir packages/account-http exec node \
  --test --test-timeout=30000 --test-shard=3/3 'test/*.test.ts'
```
