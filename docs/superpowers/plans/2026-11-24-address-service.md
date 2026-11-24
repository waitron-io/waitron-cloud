# Address service implementation plan · 24 November 2026

The signed route lets eligible paired boxes look up Spanish addresses side by side in the test stack.
Keep the suggest and validate replies, editable manual entry, Google attribution and Save as
confirmation. Keep production off until both changes below, Google billing and the privacy wording
are ready and the owner enables it. Cloud stores request counts and binding metadata.

The owner answered “yes” to the venue and Cloud caps in Lane J’s 24 November 21:20 notes. The 21:13
note records “that needs to be fixed” about the single slot. The watcher’s 22:08 note records the
signed availability agreement with Lane E.

**First change.** Wire `CLOUD_ADDRESS_LOOKUP_SETTINGS` through
`packages/account-http/src/{app,address-lookup,server-cli}.ts` and
`deploy/test-cloud/{runtime.mjs,account-worker.mjs,compose.yaml}`. The setting names one installation
environment and integer limits and prices. This change accepts only `test`. Missing or invalid
settings or a missing key refuse before charging. Read `GOOGLE_MAPS_SERVER_KEY` from the normal
account service secrets. The global switch is unset the setting and restart. The test worker takes
the same setting and key. The automated proof injects the existing synthetic provider at
`startAccountServer`.

Remove the trial box list and provider markers, trial key-file launcher, 500 ms delay, provider lock
and trial caps of 8 suggestions per workflow, 20 per day and 10 workflows per month. Keep the signed,
active installation and verified current owner checks. A missing billing profile or a cardless trial
is free. The new setting governs this route. Historical allowance rows stay readable.

Add `address-lookup-admission.ts` and one migration in `packages/registration/`. Store account,
venue, installation, workflow and operation IDs, free or paid class, kind, admitted time and price.
Include the venue stop row and admission check in this migration. Update the migration manifest and
its pinned tests. The first suggestion binds the workflow for 15 minutes or until UTC month end.
Allow one validation and reject repeated operation IDs. Let private trial workflows expire before
cutover. Extract and reuse the authority row locks from `billing-allowances.ts` before a short
accounting lock. Recheck proof and time after waits, charge and commit, then release the connection
before Google. Keep ambiguous debits. Keep the existing 30/min box and 60/min network limits. Add
60/min per owner account for provider requests through `AccountRateLimiter`.

A paying venue gets 100 validations and 500 suggestions per UTC month by default. A verified free
account gets 20 and 100 across all its venues. A search must leave room for one validation in the
quantity and price caps together. Another till can use that room before a choice is made. Lane E
sends signed `{"version":1,"kind":"available"}` to the same POST route. `200 {"available":true}`
means eligible and enough room for both calls. Use 400 for malformed input, 401 for invalid proof,
403 for ineligible or stopped boxes, 429 for limits and 503 for disabled service or missing key.
Availability uses ordinary ingress and installation throttles and spends no address quota or Google
call. Confirm with Lane E that the existing shared request limits apply.

Cap conservatively priced usage at EUR 10 per month, one tenth per day and one third of both for free
use. Use Pacific usage dates to match Google and integer millionths of a euro. Propose reserving full
list price against Cloud’s cap even when Google might apply a discount. Per 1,000 calls it is USD
2.83 for Autocomplete and USD 25 for Validation Enterprise until billing confirms USD 17 for Pro.
Configure the all-in euro price with exchange rate, taxes and fees stated separately. At an
illustrative EUR 1.10 per USD all-in, five searches and one validation cost EUR 0.043065. That allows
232 such lookups a month and 23 a day across Cloud, with 77 a month and 7 a day shared across all
free accounts. A full paid venue month prices at EUR 4.3065 and a free account month at EUR 0.8613.
One venue can spend most of the day on 312 abandoned searches. The free group can do 98. Google lists
6,000 validations per minute and separate Places quotas by project and method. Before production,
verify the Autocomplete quota and both daily quotas in the existing project and the key’s restriction
to Cloud’s IP and the two APIs.
[Places limits](https://developers.google.com/maps/documentation/places/web-service/usage-and-billing) · [Validation limits](https://developers.google.com/maps/documentation/address-validation/usage-and-billing) · [Prices](https://developers.google.com/maps/billing-and-pricing/pricing) · [Usage dates](https://docs.cloud.google.com/billing/docs/how-to/reports)

**Second change.** Enable opt-in production after the rollout gates. Reuse operator and fresh-session
proof checks via a direct method in `packages/registration/src/cloud-actions.ts`, its account route
and `apps/portal/src/cloud-actions-{controller,screen}.ts`. Find a venue by its existing ID, stop or
resume it under the venue lock, and derive the first cap notice from the call counts. Use the
existing operator identity setting in the test worker outside the restart demo. Confirm the console
as the notification channel with the watcher. Add the Google wording to the Cloud processing register
and annexes and draft the missing Cloud privacy notice with the watcher. Update the signed contract
and backlog as each piece lands.

**Checks.** `packages/account-http/test/address-lookup.test.ts` owns signed authorization, replay,
expiry, date changes, zero address debit on availability, two boxes and two tills reaching the
provider together, and one admission at the last unit. Keep authority, replay, expiry and rollback
assertions. Replace the trial-only allowlist, slot and caps checks. Run the listener with PostgreSQL
and a fake provider for the one-venue and many-free-account runs. Record attempts, prices and a
paying request after free exhaustion. Repeat the two cases in the agreed trial stack with the fake
provider before closing ADDRESS-SERVICE. ADDRESS-PROOF covers the four Waitron forms. Runtime tests
cover default-off and missing key. Operator and portal tests cover permissions, stop, resume and the
first cap notice. Estimate 350–500 code and 230–340 test lines in the first change and 180–280 code
and 100–180 test lines in the second.
