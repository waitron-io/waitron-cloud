# Deliver the Cloud sign-up volume warning

The owner asked for “Warning to us Above 10 a day” at 21:24 on 24 November.
The watcher chose email and cleared this plan at 05:00 on 25 November after
Claude's plan review and the watcher's smaller cut. Build from main. #1401
already queues the warning, independently of #1403's browser check.

A Cloud configured with a verified operator and a mail relay can deliver the
daily sign-up warning. Prove generic SMTP and Amazon SES SMTP with a local
TLS relay and synthetic settings. The hosted single-recipient SES pilot keeps operator
notices in its local inbox and supplies the operator ID in action-demo mode.
Shipping the code enables delivery in a configured environment. Spain still needs
an approved mail route, live SES qualification and Kubernetes operator account
configuration before a deployment sends it.

- In `packages/registration/test/cloud-action-notices.test.ts`, first show the worker
  fails to send the existing `signup_volume` notice through TLS with SES and with
  generic SMTP. Use the existing TLS relay fixture and check the recipient, subject,
  date, threshold and sent state. Check one bound provider message ID with SES and
  zero provider attempts with generic SMTP. Keep the existing pending-action SES
  refusal and changed-address cancellation checks. Give the pilot case a separate
  primary sender that throws, so it proves capture.
- In `packages/registration/src/smtp-mailer.ts`, implement the existing
  `sendOperatorNotice` method for payloads that pass `validSignupVolumeNotice`.
  Reject malformed warnings and pending-action notices before connecting. Cover
  both refusals in `test/smtp-mailer.test.ts`.
- In `packages/registration/src/email-outbox.ts`, allow a valid warning with a
  configured sender through existing SES admission. Reuse the recipient recheck,
  suppression, provider receipt binding, stable message ID and both language
  templates. The pilot routing stays as it is.
- Update `packages/account-http/README.md` and `docs/backlog.md`. Schema,
  deployment settings, live provider calls and the address lookup warning stay
  outside this change.

```sh
node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test --test-concurrency=1 test/cloud-action-notices.test.ts test/smtp-mailer.test.ts test/ses-smtp-settlement.test.ts
pnpm typecheck
```

Estimate 10–15 production lines and 50–65 test lines.
