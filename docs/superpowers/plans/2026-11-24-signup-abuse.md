# Slow down bulk Cloud sign-up

The owner asked for confirmation emails, rate limits and a browser check on 24 November
at 21:13. The watcher recorded the owner's limits at 21:24 and cleared two changes,
in this order, at 23:06 after Claude read the plan. Show the English and Spanish
screens in light and dark at 390 and 1280 pixels before each change lands.

1. **Sign-up limits and operator warning.** In `account-http`, admit five sign-up
   email requests per hour from the same connection, using the existing IPv6 /64
   grouping. In `registration/src/signup.ts`, keep the per-address lock and generic
   response. Queue at most three emails to an address per UTC day, at least five
   minutes apart. A link stays usable for 30 minutes. Complete at most five accounts
   per connection and five per private email domain per UTC day. Exempt the exact
   public domains listed in the account API guide. Attach any pending handover first.
   Run the checks just before consuming the link, inside the same transaction. A
   refusal rolls back both the account and its counters. The connection that completes the link counts.
2. **Warn once per UTC day.** The account API uses the existing PostgreSQL counters
   to claim a warning above ten completions across Cloud. After commit, log the date
   and threshold. If a verified operator is configured, queue an encrypted
   `operator_notice` and recheck that address before handoff. Mailpit can receive it.
   A missing operator or failed queue still leaves the account created. SMTP and SES
   keep their existing transport support. No table or migration is needed.
3. **Keep the portal and proofs aligned.** Show the connection and email-provider
   refusals as plain messages, using the watcher's 23:36 and 23:53 wording.
   Leave the form available. Show the mailbox limit on the acknowledgment and
   display the five-minute resend wait in minutes while at least a minute is left. Password reset keeps its one-minute wait and its rate
   policy. Use one validated JSON setting for the account launchers and any
   high-volume fixture. Update the P1 observer to budget the two sign-up routes
   separately and update the signup guides and backlog. Use PostgreSQL for the
   request, email, completion and rollback checks, Mailpit for the notice, and the
   portal browser tests for the copy and waits. Expect about 220 production lines and
   200 test lines for these three steps.
4. **Browser check.** The owner chose [Cloudflare Turnstile](2026-11-25-signup-turnstile.md) on 25 November, superseding this step.
