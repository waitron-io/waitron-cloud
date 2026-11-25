# Deliver the Cloud sign-up volume warning

Lane J’s `OPERATOR-NOTICE-MAIL` records “Warning to us / Above 10 a day”. Build from
`main`, per the watcher’s 04:45 note on 25 November. #1401 (`9d9f1037d`) already
queues the warning. Delivery is independent of #1403’s browser check.

A configured, verified operator can receive the existing daily warning through a
configured TLS mail relay. This slice proves the Amazon SES variant with a local
relay and synthetic settings. Production SES still requires country-policy and
provider qualification. The hosted single-recipient SES pilot keeps operator notices
in its local inbox. Test Cloud supplies the operator ID in action-demo mode.

1. **Start red.** In `packages/registration/test/cloud-action-notices.test.ts`, add
   `a sign-up volume notice reaches the verified operator through SES SMTP`. Queue
   the existing `signup_volume` payload for the verified test operator on `2026-11-24`
   with threshold `10`. Run the PostgreSQL worker using `createSmtpAccountMailer`
   and the existing `test/fixtures/ses-smtp.ts` TLS relay on loopback. Assert the
   delivery below. Run this case alone with `--test-name-pattern='through SES SMTP'`.
   Today the worker sets `delivery_configuration` before creating an SES attempt.
2. **Make it green.** In `packages/registration/src/email-outbox.ts`, select the
   optional `sendOperatorWarning` for `operator_notice` only when
   `validSignupVolumeNotice` accepts the payload. SES requires this sender before
   admission. Only a send without SES can fall back to `sendOperatorNotice`.
   Add the narrow sender to `smtp-mailer.ts`. It rejects an invalid warning with
   `delivery_rejected` before connecting. Reuse the current sign-up producer,
   English and Spanish templates, verified-address recheck, TLS and stable message
   ID. Keep SES suppression, committed admission and provider receipt binding.
3. **Check the handoff and refusals.** Assert one TLS delivery to
   `operator@example.test` with the existing subject and date and threshold in the
   body. Save the committed attempt in the relay’s recipient callback and match its
   queue ID, configuration set and tag after the worker returns. Check `sent`, cleared
   payload, stable message ID and the bound SES receipt. Exercise generic SMTP over
   TLS with zero SES attempts. In the same test file, preserve existing assertions
   and cover pending actions with a real SMTP adapter in both modes, an SES warning
   with only a capture callback, and a warning to the pilot mailbox with separate
   capture and primary adapters. Refusals must leave zero provider attempts and
   sends. Add the new sender to the existing changed-address cancellation check.
   `smtp-mailer.test.ts` checks that malformed warnings refuse before connecting.

```sh
node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test --test-concurrency=1 test/cloud-action-notices.test.ts test/smtp-mailer.test.ts test/ses-smtp-settlement.test.ts
pnpm typecheck
```

Update the transport sentence in `packages/account-http/README.md` and the warning
paragraph in `docs/backlog.md`. Record local proof in the PR and keep production
qualification open. ADDRESS-SERVICE can reuse the sender once its own slice defines
its warning. Schema, deployment settings and live provider calls are outside this
slice. Estimate 20–35 production lines and 85–110 test lines.
