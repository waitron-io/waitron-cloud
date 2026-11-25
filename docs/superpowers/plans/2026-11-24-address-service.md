# Address service implementation plan · 24 November 2026

Eligible paired test boxes can look up Spanish addresses side by side. Keep editable manual entry,
Google attribution and Save as confirmation. Cloud stores counts and request binding metadata.
The owner’s 21:13 note says to fix the single slot and the 21:20 note accepts 100 addresses and
EUR 10. Lane E agreed to signed availability at 22:08. The watcher cleared the first change with
corrections at 23:25 on 24 November. Production stays off until both changes, the billing and quota
readback, and the privacy wording are ready and the owner enables it.

## First change · signed test service

- `packages/account-http/src/{app,address-lookup,server-cli}.ts` and
  `deploy/test-cloud/{runtime.mjs,account-worker.mjs,compose.yaml}` use
  `CLOUD_ADDRESS_LOOKUP_SETTINGS` for the environment, limits and prices, and read
  `GOOGLE_MAPS_SERVER_KEY` from the account service secrets. Accept only `test` in this change.
  Missing or invalid settings or a missing key refuse before charging. Remove the settings and
  [rerun the deployment driver's `up` command](../../test-cloud.md#configure-address-lookup-for-test-boxes) to stop all lookups. Remove the trial box list, provider markers, key-file launcher, dispatch
  lock and delay, and trial workflow, day and month caps. Preserve historical allowance rows and
  let private trial workflows expire before cutover. Remove the unused `sessionToken` argument.
- `packages/registration/src/address-lookup-admission.ts` and migration `085_address_lookup.sql`
  store account, venue, installation, workflow and operation IDs, free or paid class, call kind
  and admission time. Include the venue stop row and check. Reuse the authority row locks from
  `billing-allowances.ts`, preserving refusal of missing billing records for email and translation.
  A connected or hosted base level, or an active trial with a business card, counts as
  paid. Cardless trials and missing billing records count as free for lookup. Keep the verified
  current owner and active installation checks. A short transaction lock waits for other admissions.
  After waits, recheck proof and time, count the attempt, commit and release the connection before
  calling Google. Keep ambiguous debits. Bind a workflow on its first suggestion for 15 minutes.
  Allow one validation and refuse repeated operation IDs.
- Per Pacific month, a paying venue gets 100 validations and 500 suggestions. A verified free
  account gets 20 and 100 across its venues. Every suggestion counts, including abandoned searches.
  The suggestion must leave room for a validation across the caps. Another till can use that room.
  With about five suggestions per choice the venue can choose 100 addresses. At sixteen per choice,
  its 500 suggestions cover 31. Lane E’s five automatic searches per open form must land before
  ADDRESS-PROOF. Enter can send more.
- Update the signed integration contract. `{"version":1,"kind":"available"}` returns
  `200 {"available":true}` when the box may make both calls. It spends no lookup quota and never
  calls Google. Ordinary ingress and installation throttles apply to this check. Provider calls get
  lookup-only limits of 30/min per box and 60/min each per network and owner account, using
  `AccountRateLimiter`. Preserve 400 for invalid input, 401 for invalid proof, 403 for ineligible or
  stopped boxes, 409 for a workflow conflict, 410 for an expired workflow, 429 for limits and 503
  when disabled or missing a key.

## Cloud spending limits

Each Pacific month, price `max(0, searches − 10,000)` and `max(0, validations − 5,000)` at the
configured rates, capped together at EUR 10. The daily free quantities and euros are one tenth of
that. Free accounts collectively get one third of each monthly quantity and euro limit, and one
thirtieth per day. The free quantities and euro limits for the four periods are configurable.
Store call counts and use integer millionths of a euro for the calculation. Model Google’s Pro
validation tier until the billing readback, using USD 2.83 per 1,000 searches and USD 17 per 1,000
Pro validations. Enterprise validation has 1,000 free and costs USD 25 per 1,000 after that.

At an illustrative all-in EUR 1.10 per USD and five searches per choice, the Cloud and free-group
caps allow 2,642 and 880 choices per month, or 264 and 88 per day. At Enterprise rates they allow
1,363 and 454 per month, or 136 and 45 per day. If Pro is configured but Google bills Enterprise,
2,642 choices cost about EUR 55. The Pro illustration allows up to 1,321 search-only attempts in a
day across Cloud and 440 across free accounts, with room for one validation. One paying venue can
make at most 500 such searches in a month. One owner with three paid venues can use the entire
Cloud daily search allowance in about 22 minutes at 60 requests per minute. Many free accounts
can fill their collective share.
Use the confirmed pricing tier and remaining billing-account free quantities before enabling
production. Google publishes 6,000 validation requests per minute and a separate per-project quota
for each Places API method. Record the project’s actual Autocomplete quota and both daily quotas,
and confirm that the key is restricted to Cloud’s IP and the two APIs.
[Google pricing](https://developers.google.com/maps/billing-and-pricing/pricing) · [Places quotas](https://developers.google.com/maps/documentation/places/web-service/usage-and-billing#usage-limits) · [Validation quotas](https://developers.google.com/maps/documentation/address-validation/usage-and-billing) · [Pacific usage dates](https://docs.cloud.google.com/billing/docs/how-to/reports)

The PostgreSQL listener test starts with 499 searches for one paired paying venue and 439 across
five paired free owners. At the illustrative rates it accepts search 500 for the paying venue and
440 for the free group, then refuses both next searches. The paying venue can still validate.
Those 440 free searches consume EUR 0.333091 of the configured free group day budget. The test
supplies synthetic prior usage and an injected provider.

## Second change · operator controls and production readiness

The [cleared operator slice](2026-11-25-address-service-operator.md) records the implementation scope and local evidence expected for this change.

Reuse fresh-session and operator checks in `packages/registration/src/cloud-actions.ts`, its account
route and `apps/portal/src/cloud-actions-{controller,screen}.ts` to stop or resume a venue by ID.
Use the existing operator identity setting, queued `operator_notice` email and log line to report
the first cap event. Verify operator email delivery through OPERATOR-NOTICE-MAIL. Add Google’s
processing-register row, annex lines and one privacy paragraph. Production billing currently lacks
the test-only trial and payment flows, so plan for venues to count as free until paid status is
available there. Delete address-call records once they are outside the current Pacific month and
older than 30 minutes, so a partly deleted workflow that crossed midnight cannot regain time. Permit
opt-in production only after the rollout gates. Update the backlog as each change lands.

## Checks and size

`packages/registration/test/address-lookup-admission.test.ts` covers paid and free classification,
quantity and spend caps, Pacific boundaries and the last-unit race against PostgreSQL.
`packages/account-http/test/address-lookup.test.ts` covers proof, status codes, replay, expiry,
rollback, address-free storage, quota-free availability, and two boxes and two tills reaching the
provider together. Keep the provider failure tests in `address-lookup-google.test.ts`. Use the real
PostgreSQL listener with the injected provider for the one-venue and many-free-account checks.
Record attempts, prices and a paying request after free exhaustion. Test default-off and missing
key in runtime tests. Update the migration manifest and pinned migration tests. ADDRESS-PROOF
covers the four Waitron forms. Operator tests cover permissions, stop, resume and the first notice.
Estimate 350–500 product and 230–340 test lines for the first change, 180–280 product and 100–180
test lines for the second. If the first change cannot fit, bring the settings, key and worker-wiring
cut to the watcher before changing the plan.
