# Address service implementation plan · 24 November 2026

On `feat/j-address-service`, turn the landed trial (#1398) into an opt-in Spanish address service for
any eligible connected box. Keep editable manual entry, Google Maps attribution, Save as confirmation
and the existing signed suggest/validate contract. The service stores no query, address or provider
reply. Signup-abuse runs independently.

**Signed route.** In `packages/account-http/src/{app,address-lookup,rate-limit}.ts`, use the existing
installation signature and lease, current verified owner and matching venue. Keep nonce replay
protection for provider requests and bind each workflow to its installation, venue and owner, with
fifteen-minute expiry capped at the UTC month end and one validation. Carry forward existing workflow
bindings so a spent or expired workflow cannot reopen. Lane E sends signed
`{"version":1,"kind":"available"}` to `POST /api/installations/address-lookup`. Return `200
{"available":true}` only when enabled, the key file is usable, the box is eligible and both call types
fit current caps and minute limits. Otherwise use ordinary refusal. This is a snapshot. Route the
bounded availability body before `all-ip` is charged (`app.ts:183`). Read that counter and the
installation network and box counters (`address-lookup.ts:172–176`) alongside the account limit. Never
write a counter, nonce, workflow or notice or call the provider for availability. Preserve the usual
write-path rate gates (120/min outer IP, 60/min installation network, 30/min box) and propose 60/min per
owner account.

**Admission and cost.** Append `085_address_service.sql` in `packages/registration/migrations/` and
register it in `migrate.ts`. Keep small address-only workflow, counter and venue-stop records. In
`packages/registration/src/address-admission.ts`, reuse the transaction and billing authority patterns
in `billing-allowances.ts`. A paying venue gets 100 validations and 500 suggestions per UTC month by
default. Free use gets 20 and 100 shared per verified account, including trials without a card. Use
current billing facts and keep the validation limit configurable, with suggestions at five times that
limit. Every admitted attempt counts, including abandoned searches and ambiguous failures. In one short
transaction lock the applicable UTC buckets in fixed order, check and debit all caps, and recheck
authority, proof expiry and bucket time after contention. Commit and release the connection before
provider I/O. Remove the trial slot and delay. An acknowledged stop blocks new admissions.

Apply three independent money checks: EUR 10/month total (configurable), one tenth/day and a free share
of one third of both, rounded down. The free share leaves the rest available to paid venues. Propose
reserving the full marginal price even for calls Google might bill at zero, so prior use of Google's
free units changes nothing. Per 1,000, reserve Autocomplete at USD 2.83 and Validation at USD 25
(Enterprise) until billing confirms USD 17 (Pro). Use integer millionths of a euro, rounding each call
up at a watcher-approved upper bound for exchange, tax and fees. An illustrative EUR 1.10/USD reserves
3,113 and 27,500 per call. Keep the service off if the actual billing category or all-in rate exceeds
the reservation. Google sets Places limits per API method per project. At rollout read the existing
project's Autocomplete quota and check expected aggregate traffic against it and Validation's 6,000
queries/minute. Watcher owns billing verification, key IP/API restrictions and provider-side daily caps.
[Places limits](https://developers.google.com/maps/documentation/places/web-service/usage-and-billing) ·
[Validation
limits](https://developers.google.com/maps/documentation/address-validation/usage-and-billing) ·
[Prices](https://developers.google.com/maps/billing-and-pricing/pricing)

**Operations.** Wire opt-in settings through `packages/account-http/src/server-cli.ts` and
`deploy/test-cloud/{runtime,account-worker}.mjs`. Reuse `test-box-address-lookup.ts` and its protected
key-file checks. In the existing operator console
(`apps/portal/src/cloud-actions-{controller,screen}.ts` and
`packages/{account-http,registration}/src/cloud-actions.ts`), reuse operator/session/write-proof checks
for a direct venue stop switch. Record the first cap hit once per scope and UTC window in the accounting
transaction and show it as an operator notice. Watcher choice is whether the console notice needs email
delivery. `packages/registration/src/email-outbox.ts:305–309` requires a pending Cloud action for
existing operator mail, so email would need a dedicated cap notice through the outbox. Update the signed
contract in `docs/address-lookup-trial.md` and the open work in `docs/backlog.md`. Name Google for
address lookup in the Cloud privacy notice and the processor and subprocessor material in
`docs/cloud-data-processing-register.md` and `docs/cloud-processing-annexes.md`.

**Focused tests.** Write failing cases first in `packages/account-http/test/address-lookup.test.ts`
using PostgreSQL and a blocked synthetic provider. Name them `availability never spends counters`, `two
boxes and two tills on one box overlap at the provider`, `last unit admits exactly one`, and `a cap
notifies once and a venue stop blocks admission`. Keep authority, reply, expiry, replay, rollback and
one-validation assertions. Replace the trial-only slot, allowlist and quota assertions deliberately. Run
key-file, operator permission, migration and default-off runtime checks alongside. In the synthetic
trial stack, report accepted attempts by type and USD/EUR equivalents for one venue/account and for many
invented free accounts. Reference ceilings are 500 suggestions plus 100 validations per paying venue
(USD 3.915/EUR 4.3065 at Enterprise) and 1,070 abandoned free suggestions per month, at most 107/day
(USD 3.0281/EUR 3.33091 per month at the illustrative rate), with paid capacity still available.
Estimated size is 450–600 lines of code and 220–320 lines of tests.
