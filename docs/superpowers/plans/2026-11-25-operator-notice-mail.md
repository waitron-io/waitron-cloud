# Deliver the Cloud sign-up volume warning

Lane J’s `OPERATOR-NOTICE-MAIL` records the owner’s “Warning to us / Above 10 a day”.
Build from `main`, as the watcher directed at 04:45 on 25 November. The queued warning
is already on `main` in #1401 (`9d9f1037d`). This work is independent of #1403’s browser check.

Once per UTC day above the default threshold of ten completed sign-ups, the
configured, verified operator can receive the existing warning through SMTP,
including Amazon SES. Reuse the producer in `packages/account-http/src/signup-limits.ts`,
the encrypted `signup_volume` notice and the English and Spanish templates in
`packages/registration/src/account-mail.ts`.

1. **Start red.** Add `a sign-up volume notice reaches the verified operator through
   SES SMTP` to `packages/registration/test/cloud-action-notices.test.ts`. Enqueue
   the existing payload for its verified operator, date `2026-11-24` and threshold
   `10`. Run the real PostgreSQL worker with `createSmtpAccountMailer`, synthetic SES
   settings and the existing `test/fixtures/ses-smtp.ts` TLS relay on loopback. Assert
   the delivery described below. The current worker instead marks the row `failed`
   with `delivery_configuration`, before either SMTP or an SES attempt.
2. **Make it green.** In `packages/registration/src/email-outbox.ts`, route an
   `operator_notice` accepted by `validSignupVolumeNotice` to the optional
   `sendSignupVolumeNotice` sender, with the existing capture callback as fallback.
   Keep the single-recipient SES pilot’s operator notices in capture and preserve
   pending-action provider refusal. Add the narrow sender to `smtp-mailer.ts` using
   the existing validator, token-free template, TLS delivery and stable message ID.
   `configured-mailer.ts` already uses this adapter for both SMTP modes. Reuse the
   worker’s verified-address recheck, SES admission with recipient suppression, and
   provider receipt binding.
3. **Check the handoff.** Assert one TLS envelope to `operator@example.test` and the
   existing subject and body with the date and threshold. Read the committed attempt
   at the fixture’s recipient callback and match its queue ID, configuration set and
   tag to the captured email. After acceptance, assert `sent`, cleared payload, the
   stable message ID and the SES receipt on that attempt. Exercise the same sender
   through plain SMTP with zero SES attempts, and cover warning capture in pilot mode.
   Preserve the existing cases. Use `scripts/test-postgres.mjs` and `--test-concurrency=1`
   for `cloud-action-notices.test.ts`, `smtp-mailer.test.ts`, and `ses-smtp-settlement.test.ts`.

Update the warning paragraph under **Cloud signup and business moves** in
`docs/backlog.md` and the transport sentence in `packages/account-http/README.md`.
Record local proof. Live provider qualification remains open. Address-service can
reuse the transport once its own slice defines its warning. Schema, configuration,
and provider setup are outside this slice.

Estimate 20–35 production lines and 60–85 test lines.
