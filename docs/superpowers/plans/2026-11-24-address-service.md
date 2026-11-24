# Address service implementation plan · 24 November 2026

The signed route lets eligible paired boxes look up Spanish addresses side by side in the test stack.
Keep the suggest and validate replies, editable manual entry, Google attribution and Save as
confirmation. Keep production off until both changes below, Google billing and the privacy wording
are ready and the owner enables it. Cloud stores request counts and binding metadata.

**First change.** In `packages/account-http/src/{app,address-lookup,server-cli}.ts` and `deploy/test-cloud/{runtime.mjs,account-worker.mjs,compose.yaml}`, add an opt-in `CLOUD_ADDRESS_LOOKUP_SETTINGS` with integer venue, budget and per-call price limits. Refuse invalid settings and check the account service's secret for a usable Google key before charging. Use the existing account secret and synthetic provider paths. Require the current verified owner, active installation and matching signed lease in the correct environment. Use current billing authority and classify a box without a paid plan or with a cardless trial as free. A missing billing profile is free. The new setting governs the route. Preserve old trial allowance rows and unrelated allowance behavior.

Add `address-lookup-admission.ts`, a migration, and its manifest entry under `packages/registration/`.
One call table holds binding, kind, admitted time and price. Use the first suggestion to bind and
expire the workflow at 15 minutes or UTC month end. Keep one validation per workflow and reject
replayed operation IDs. Let old private trial workflows expire. Reuse the owner, membership, billing,
venue and installation locks from `billing-allowances.ts` before a single short accounting lock.
Recheck authority, proof and clock after waits. Charge before committing, release all locks and the
connection before Google, and keep the debit for an ambiguous result. Give lookups their own minute
limits derived from the call table (30 per box, 60 per network and 60 per account proposed).
Use the existing IPv6 /64 and store a keyed network digest.

A paying venue gets 100 validations and 500 suggestions per UTC month by default. A verified free
account gets 20 and 100 across all its venues. A search must leave room for one validation in the
quantity and price caps together. Another till can use that room before a choice is made. Lane E
sends signed `{"version":1,"kind":"available"}` to the same POST route. `200 {"available":true}` means
eligible and enough room for both calls, with the normal ingress limit still applied. Availability
reads address limits and spends no address quota, workflow, replay record or Google call.

Cap conservatively priced usage at EUR 10 per month, one tenth per day and one third of both for
free use. Use Pacific usage dates to match Google and integer millionths of a euro. Propose charging
the full list price even when Google might apply a discount. Per 1,000 calls it is USD 2.83 for
Autocomplete and USD 25 for Validation Enterprise until billing confirms USD 17 for Pro. Configure
the all-in euro price with exchange rate, taxes and fees stated separately. At an illustrative EUR
1.10 per USD all-in, five searches and one validation cost EUR 0.043065. That allows 232 such
lookups a month and 23 a day across Cloud. A single paying venue can exhaust the day. Google lists
6,000 validations per minute and separate Places quotas by project and method. Read the numeric
Autocomplete quota from the existing project before enabling and check both provider daily quotas.
[Places limits](https://developers.google.com/maps/documentation/places/web-service/usage-and-billing) · [Validation limits](https://developers.google.com/maps/documentation/address-validation/usage-and-billing) · [Prices](https://developers.google.com/maps/billing-and-pricing/pricing) · [Usage dates](https://docs.cloud.google.com/billing/docs/how-to/reports)

**Second change.** Reuse `CloudActions` operator and current-session proof checks in the account
route and `apps/portal/src/cloud-actions-{controller,screen}.ts`. Find a venue by its existing ID,
stop or resume it under the venue lock, and derive cap notices from the call counts. Use the existing
operator mail path only with an approved notice purpose. Add the Google wording to the Cloud
processing register and annexes and draft the missing Cloud privacy notice with the watcher. Update
the signed contract and backlog as each piece lands.

**Checks.** `packages/account-http/test/address-lookup.test.ts` owns signed authorization, replay,
expiry, date changes, zero address debit on availability, two boxes and two tills reaching the
provider together, and one admission at the last unit. Keep its existing security assertions.
Run the listener with PostgreSQL and the fake provider for the one-venue and many-free-account runs.
Record attempts, costs and a paying request after free exhaustion. Runtime tests cover default-off
and missing key. Operator and portal tests cover permissions, stop, resume and the first cap notice.
Plan for 320–450 code and 200–300 test lines in the first change, and 180–280 code and 100–180 test
lines in the second.
