# Identity and organisations

## Decisions and deliberate limits

The owner selected Amazon SES in an EU region on 2026-10-21, an explicit email
exception to Spain home storage. The owner accepts Stockholm (`eu-north-1`), the
configured default, or Paris (`eu-west-3`). D102 still qualifies the exact account,
entities, processing/access locations, retention and tracking controls. D565
authorises local feedback code/tests and [offline policy validation](../ses-feedback-qualification.md);
provider resources, credentials and live delivery need separate owner authority. This selection does not prove setup
or delivery, and does not move venue databases, logs or keys out of Spain.

## Requirements and remaining work

Signup, recovery, passkeys, the authenticator app, account sessions, pairing approval, the
encrypted email queue, the security trail and disabled support grants are implemented and
checked locally, in English and Spanish. The package guides and tests describe them. Open:

- **Email.** Live delivery; authenticated bounce and complaint ingestion, suppression
  reconciliation and delivery alerts before public use ([SMTP adapter](../production-email-implementation.md)).
  A timeout or crash after provider acceptance may duplicate an email.
- **Keys.** Choose and operate the production email and factor key stores; retain each database
  backup's matching key set. No production factor policy or key configuration is selected
  ([operator guide](../authenticator-app.md)). Session cleanup keeps factor-referenced rows until
  a separate retention policy is approved. Password reset keeps the factor, and factor changes
  end every session (approved policy).
- **Recovery for legacy accounts.** Define it separately for unverified and passwordless
  accounts.
- **Support and platform roles.** Define the platform role, eligibility and action catalogues,
  customer approver policy, emergency route, SSH session-termination contract and the audit events
  not covered by the customer security trail before enabling
  [support grants](../temporary-support-grants.md).
- **Retention.** Choose legal and operational cutoffs for sessions, signup and password-reset
  requests (including reset records for unknown addresses), terminal delivery metadata, audit
  retention and account deletion, and measure the [dry-run](../history-cleanup.md) counts against
  the expected deployment size first. No automatic deletion is enabled. The security trail is not
  a complete compliance archive.
- **Ingress.** Validate production ingress, TLS and bot controls. Login's response floor, account
  and cooldown timing under contention, and targeted address-lockout mitigation need deployment
  measurement and the ingress policy, not a blind quota change. Rotating the shared rate key
  starts new allowances. Deployment-wide outage presentation is an ingress responsibility. Decide
  whether to accept tracking queries and trailing-slash/case aliases, and set the retirement point
  for legacy query-token links after every deployed sender generates fragments and all remaining
  query tokens have expired.
- **Passwords.** Choose, verify and operate the production compromised-password corpus; an
  external provider needs a processing-location and residency decision. No password or complete
  digest is sent externally. Review the inherited password cost for deployment.
- **Reuse.** Take code and behavioural tests from Waitron's `pre-sqlite-migration`, pinned to
  `c9d80c59a30ab1ae7a4acc0a6999e6a342de924e` in the registration plan. Keep the
  [identity source review](../identity-upstream-review.md) current (classified through
  `60dcf75a5132`, 20 November 2026) and port security fixes with failing regression tests in each
  affected repository. Local till staff need no Cloud account. Passkey provider-name display and
  browser credential synchronisation are optional follow-ups.
- **Unexplained.** The sign-out prompt failure in CI40331684104, the earlier
  authenticator-rotation lock probes and the English/light/1280 sign-in timeouts have no captured
  ordering. Capture the request and locator stage on a recurrence and reproduce the cause before
  changing a check or deadline.

## Shared action-proof email confirmation in CI

The English, dark, desktop case in portal shard 2/6 of
[run 43490222222](https://github.com/waitron-io/waitron-cloud/actions/runs/43490222222/job/132109256464)
failed at `account-action-proof-browser.test.ts:22:399` while waiting seven seconds
for email-proof confirmation. Its cause remains unknown. The unchanged focused
file passed all eight cases on a disposable Linux guest. A separate bounded
24-case diagnostic saw every received synthetic code match its queued code and
every verification reply return 204; it did not reproduce the hosted failure.
Capture the failing verification response and browser request stage on recurrence,
then reproduce the cause before changing any check or deadline. A passing hosted
retry does not repair this failure.

Return to the [backlog index](../backlog.md#platform-work-to-scope).
