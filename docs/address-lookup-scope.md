# Scope address lookup before choosing a provider

**Decision note, 2026-09-30.** Offer address suggestions to people setting up an open-source Waitron venue through a Cloud login, while keeping every existing address field editable. Do not select a provider yet. A useful suggestion is not enough: Waitron must be allowed to save the selected address as a durable merchant record, map it safely into its country pack, and sustain the resulting traffic within a stated allowance and budget. **Geoapify is the first hosted candidate to test across countries; CartoCiudad is a Spain-specific comparator.** Google and Mapbox warrant a bounded quality comparison only if their intended storage and display rights can be confirmed. Public Nominatim cannot serve live autocomplete under its published policy. The prices below are dated list-price scenarios, not quotes or measured demand. No keys, live provider requests, spending, or customer data were used in this research.

## A selected address must remain an editable Waitron draft

The captured Waitron setup form has editable `addressLine1`, `addressLine2`, `postalCode`, `city`, and `province` inputs. Its country pack validates postal code and province, then the server checks fiscal territory and time zone separately before storing a venue. The location schema persists the address fields; fiscal rows have their own append-only rule. These are **code observations at Waitron commit `a9f61aba8c62591b5b1eb89526ed04046dac53d6`**, not an executed lookup flow. ([Setup form and validation](https://github.com/clintongormley/waitron/blob/a9f61aba8c62591b5b1eb89526ed04046dac53d6/apps/setup/src/screens/venue-screen.ts#L415-L445), [server checks](https://github.com/clintongormley/waitron/blob/a9f61aba8c62591b5b1eb89526ed04046dac53d6/apps/server/src/setup-api.ts#L320-L389), [location fields](https://github.com/clintongormley/waitron/blob/a9f61aba8c62591b5b1eb89526ed04046dac53d6/packages/db/src/schema/tenants.ts#L89-L103), [fiscal classification](https://github.com/clintongormley/waitron/blob/a9f61aba8c62591b5b1eb89526ed04046dac53d6/packages/fiscal-verifactu/src/classification.ts#L5-L23))

When you select a suggestion, propose its street and number as line 1, any usable unit/detail as optional line 2, locality as city, and postcode as postal code. Resolve the provider's administrative code through the selected Waitron country pack before proposing a province. Require its country to match the country already selected for the venue. Let the person review, correct, or ignore the proposal, and submit through the existing client and server checks. A provider result must never set fiscal territory, time zone, tax identity, invoice series, or issued fiscal records directly. This mapping is a **proposed integration contract**, not implemented behavior. Provider timeout, no match, unsupported area, or invalid postal/province pairing must leave manual entry usable. The existing backlog already requires manual entry and correction. ([Country-pack contract](https://github.com/clintongormley/waitron/blob/a9f61aba8c62591b5b1eb89526ed04046dac53d6/packages/country/src/country.ts#L21-L75), [Cloud free-service proposal](https://github.com/waitron-io/waitron-cloud/blob/427193f8ae5d8a19d77bd132c876f2be56117e6b/docs/backlog.md#L201-L230))

Treat three things separately: the person's original text, a transient suggestion shown while typing, and provider-derived components or coordinates saved after selection. **A click does not itself grant permanent storage rights.** Check the intended merchant record, later editing/display, cache lifetime, and any map display against the applicable provider terms before implementing persistence.

## Published coverage leaves address quality unmeasured

| Candidate | What the published material supports | Persistence, attribution, and location question | Operational constraint |
| --- | --- | --- | --- |
| **Geoapify** | Autocomplete and geocoding expose structured address fields, country filters, and Spanish, Portuguese, French, and Italian language options. Data includes OpenStreetMap and OpenAddresses; no comparable country-level house-number match rate is published. ([API docs](https://apidocs.geoapify.com/docs/geocoding/address-autocomplete/), [sources](https://www.geoapify.com/products-and-services/)) | Its autocomplete product page permits storing and caching suggestions; confirm that intended merchant reuse is covered. OpenStreetMap credit is required, plus Geoapify credit on Free. Its DPA says `api-eu.geoapify.com` keeps requests EU-bound; the default endpoint uses Cloudflare. Confirm the agreement and use the EU hostname if that boundary is required. ([Storage guidance](https://www.geoapify.com/address-autocomplete/), [Terms](https://www.geoapify.com/terms-and-conditions/), [DPA](https://www.geoapify.com/data-processing-agreement/)) | Free: 3,000 credits/day and up to 5 requests/second; paid tiers raise both limits. ([Pricing](https://www.geoapify.com/pricing/)) |
| **CartoCiudad** | Spain's official-data service combines national, regional, and local sources and includes postal/locality fields. Its dataset count and update schedule describe availability, not accuracy for Waitron addresses. `candidates` can be followed by `find` for a non-point result. ([FAQ](https://www.cartociudad.es/web/portal/faq), [service guide](https://www.cartociudad.es/web/portal/directorio-de-servicios/geoprocesamiento)) | Published FAQ allows commercial use with CC BY 4.0 credit. Confirm how attribution should appear in this product, plus request-data retention and processing location. ([FAQ](https://www.cartociudad.es/web/portal/faq)) | Web service is free, but the reviewed guide does not publish a per-client throughput limit or service commitment. Confirm production expectations with its operator. ([Service guide](https://www.cartociudad.es/web/portal/directorio-de-servicios/geoprocesamiento)) |
| **Google Places / Address Validation** | Validation explicitly lists ES, PT, FR, IT, while warning that quality varies by country. Its validation output is different from a Places suggestion. ([Coverage](https://developers.google.com/maps/documentation/address-validation/coverage)) | Default Maps policies restrict storing returned content, with Place IDs as an exception, and require Google attribution. EEA billing can change applicable Places rules; the reviewed documents do not establish a Maps endpoint residency promise. Obtain written clarity for durable merchant fields and any map display. ([Validation policies](https://developers.google.com/maps/documentation/address-validation/policies), [EEA Places changes](https://developers.google.com/maps/comms/eea/places)) | Address Validation defaults to 6,000 requests/minute; configure project quotas for the chosen APIs. ([Quota documentation](https://developers.google.com/maps/documentation/address-validation/usage-and-billing)) Session billing depends on whether autocomplete ends in Details or Validation; abandoned sessions bill per suggestion request. ([Session pricing](https://developers.google.com/maps/documentation/places/web-service/session-pricing)) |
| **Mapbox Search Box** | Documents Europe-wide Search Box coverage and relevant query languages, without a country-by-country address match measure. ([Search Box API](https://docs.mapbox.com/api/search/search-box/)) | Search Box results are temporary-use only. Separate permanent Geocoding permits storage, but its pricing terms restrict redistribution/sublicensing; confirm multi-tenant merchant use in writing. Mapbox says it cannot limit processing to Europe. ([Search Box](https://docs.mapbox.com/api/search/search-box/), [Geocoding](https://docs.mapbox.com/api/search/geocoding/), [pricing](https://www.mapbox.com/pricing), [privacy FAQ](https://www.mapbox.com/legal/privacy)) | A Search Box session ends on retrieval, timeout, or suggestion cap; default endpoint limit is 10 requests/second. Confirm the effective timeout and preview-plan eligibility. ([Search Box API](https://docs.mapbox.com/api/search/search-box/)) |
| **Nominatim** | OpenStreetMap-based search can parse structured addresses; completeness depends on contributed map data. A self-hosted instance is a separate infrastructure option. ([Search API](https://nominatim.org/release-docs/develop/api/Search/), [installation](https://nominatim.org/release-docs/latest/admin/Installation/)) | OSM attribution and ODbL questions depend on the data stored or distributed; review the exact use. ([OSM copyright](https://www.openstreetmap.org/copyright/es)) | **Public service forbids autocomplete** and allows at most 1 request/second per application. Self-hosting removes that public-service policy but adds index, update, capacity, and uptime work. ([Public policy](https://operations.osmfoundation.org/policies/nominatim/)) |

Published service coverage and CartoCiudad's record count do not establish that a particular rural Spanish venue, unit number, accented street, or postal boundary will match correctly. Likewise, Geoapify confidence fields are provider output, not independent accuracy evidence. Keep Spain as the first quality gate; only consider Portugal, France, or Italy when the relevant Waitron country pack and the same mapping checks are ready. An EU endpoint also does not, by itself, settle every contract or privacy question.

## Six-point-six provider calls can underlie one completed address

For a comparable **30-day monthly scenario**, assume **N completed selections**, five autocomplete HTTP calls for each completion, and 20% as many abandoned attempts as completions, each making three calls. Thus suggestions total `5N + 3(0.2N) = 5.6N`. Geoapify's modeled flow adds one forward-geocoding request per selection, for **6.6N calls/credits**; if the selected autocomplete payload is sufficient, remove that extra `N`. Google Validation uses one terminating validation per completion; correctly terminated suggestions are free under that session route, while abandoned suggestions are billed per request. Mapbox Search Box bills one session for each completion or abandonment, including sessions that time out. These are **HTTP calls**, not counts of suggestion rows returned in one response. ([Geoapify pricing detail](https://www.geoapify.com/pricing-details/), [Google session pricing](https://developers.google.com/maps/documentation/places/web-service/session-pricing), [Mapbox API](https://docs.mapbox.com/api/search/search-box/))

| Monthly completions / abandoned attempts | 1,000 / 200 | 10,000 / 2,000 | 100,000 / 20,000 |
| --- | ---: | ---: | ---: |
| Autocomplete HTTP calls | 5,600 | 56,000 | 560,000 |
| Geoapify total calls with selected geocode; average/day | 6,600; 220 | 66,000; 2,200 | 660,000; 22,000 |
| Geoapify autocomplete-only calls if selected payload suffices | 5,600 | 56,000 | 560,000 |
| Geoapify lowest listed tier at even traffic | Free, **$0/month** | Free, **$0/month** | API 25, **$109/month** |
| Google Autocomplete + Address Validation, including abandoned calls | **$0.00** | **$225.00** | **$2,616.50** |
| Mapbox Search Box, published preview schedule | **$2.10** | **$34.50** | **$353.50** |
| Mapbox Search Box, published standard schedule | **$0.00** | **$109.25** | **$1,321.25** |
| CartoCiudad / self-hosted Nominatim | No published per-call price / hosting unestimated | No published per-call price / hosting unestimated | No published per-call price / hosting unestimated |

Geoapify's published credits are per request, with Free at 3,000/day, API 10 at 10,000/day for $59/month, API 25 at 25,000/day for $109/month, and API 50 at 50,000/day for $179/month. The selected autocomplete payload may already have all the address components Waitron needs. In that case the autocomplete-only row is the applicable call estimate, and 100,000 completions average about 18,667 credits/day. **Daily peak and requests per second govern plan choice:** the conservative geocode flow averages 22,000 credits/day at that volume, but a day over 25,000 exceeds API 25's stated envelope even when the month's average fits. API 50 is the next listed tier. Geoapify describes its daily limit as soft, not an unlimited monthly pool. Its terms reserve suspension or overage charges and qualify commercial production use of Free; confirm eligibility before treating either $0 scenario as a launch budget. ([Plan terms](https://www.geoapify.com/terms-and-conditions/)) ([Pricing](https://www.geoapify.com/pricing/), [Autocomplete API](https://apidocs.geoapify.com/docs/geocoding/address-autocomplete/))

Google's row applies its listed 1,000 free monthly Address Validation Enterprise requests, then $25 per 1,000 through 100,000; abandoned autocomplete uses a separate 10,000-request free cap, then $2.83 per 1,000 through 100,000. At 100,000 completions, that is `$2,475` validations plus `(60,000 - 10,000) × $2.83/1,000 = $141.50` abandoned calls. **A Place Details Essentials termination is a different flow and must be priced separately** if that is the chosen product behavior. The Google global list is not a commitment for the actual billing account. ([Google price list](https://developers.google.com/maps/billing-and-pricing/pricing), [session pricing](https://developers.google.com/maps/documentation/places/web-service/session-pricing))

Mapbox's preview schedule gives 500 free sessions then $3/1,000 through 100,000 and $2.75/1,000 through 500,000; its standard schedule shows 2,500 free, then $11.50/1,000 through 100,000 and $10/1,000 through 200,000. The standard table calls its unit “requests” while the product page describes sessions, so **confirm the effective plan, billing unit, and preview eligibility** before budgeting. Its pricing page and API reference also differ on session expiry timing. CartoCiudad's same five-call pattern would imply up to `6.6N` calls if each selected non-point result needs `find`; its free price does not establish capacity at that volume. No responsible self-hosted Nominatim total follows without a deployment size and operator-cost estimate. All dollar figures are public USD list estimates, excluding tax, discounts, retries, burst overages, and future price changes. ([Mapbox pricing](https://www.mapbox.com/pricing), [CartoCiudad guide](https://www.cartociudad.es/web/portal/directorio-de-servicios/geoprocesamiento))

## The Cloud account owns the allowance; provider calls remain separate

The Cloud proposal promises free lookup for a Cloud account without a paid subscription, with a per-user allowance and visible remaining balance. Current Cloud code separates accounts, organisation memberships, venues, and installation credentials. Pairing binds an installation to a venue and checks an approving Cloud session; it does **not** turn local staff identities into Cloud users. Existing usage events and summaries are organisation-scoped observations for other services, not account-level lookup entitlements. These are **code and design observations at Cloud commit `427193f8ae5d8a19d77bd132c876f2be56117e6b`**, not a working address route. ([Registration schema](https://github.com/waitron-io/waitron-cloud/blob/427193f8ae5d8a19d77bd132c876f2be56117e6b/packages/registration/migrations/001_registration.sql#L1-L36), [pairing flow](https://github.com/waitron-io/waitron-cloud/blob/427193f8ae5d8a19d77bd132c876f2be56117e6b/packages/registration/src/pairing.ts#L17-L80), [metering design](https://github.com/waitron-io/waitron-cloud/blob/427193f8ae5d8a19d77bd132c876f2be56117e6b/docs/superpowers/specs/2026-09-26-cloud-usage-metering-design.md#L5-L34))

Propose **one customer allowance unit for one user-initiated selected address resolved**, regardless of keystrokes. Attribute a venue-originating request through an authenticated installation and an explicit authorized Cloud account; all installations assigned to that account share its allowance. Decide how organisation members select or share that account and what membership changes do. Count raw provider requests, sessions, retries, failed lookups, and cost independently for budgeting and abuse control; do not call an organisation usage total a per-user balance. Proxy credentials through Cloud. Keep raw queries, full provider responses, and addresses out of metering metadata; retain only the account attribution, fixed unit and service, outcome, idempotency identity, and timestamp needed for accounting. Define reset period, allowance size, exhausted-limit behavior, and whether failures or cached selections debit the customer unit before enforcement. ([Identity boundary](https://github.com/waitron-io/waitron-cloud/blob/427193f8ae5d8a19d77bd132c876f2be56117e6b/docs/product-and-platform.md#L326-L335), [free-service backlog](https://github.com/waitron-io/waitron-cloud/blob/427193f8ae5d8a19d77bd132c876f2be56117e6b/docs/backlog.md#L218-L230))

Before a venue is paired, propose a Cloud sign-in and narrowly scoped, expiring lookup authorization for that account. Do not require a paid subscription or an existing installation merely to fill the setup form. After pairing, require both installation authority and explicit account attribution; the installation credential alone grants no person’s allowance. The sign-in handoff, delegation, revocation and concurrent quota reservation still need a reviewed contract and implementation. A retry with the same operation identity should debit a completed selection once. Bound suggestion traffic separately, because abandoned searches can cost money without consuming that selection allowance. Send the provider only the address query, country/language constraints and necessary session token, never Cloud identity, tax ID or installation credentials. This is the proposed shared free-service account boundary for the subsequent email-relay scope.

## Test Spain first and resolve the owner decisions

Build a licensed public or synthetic corpus with expected components independent of each provider. Include mainland and island provinces, rural localities, accents and language variants, street numbers and units, postcode boundaries, ambiguous streets, typos, and unsupported fiscal jurisdictions. Run the same country-restricted input through Geoapify and CartoCiudad for Spain; add Google and Mapbox only when their proposed persistence and display terms are clear enough to test the intended flow. Score selectable match, wrong match, exact house number, postcode, locality, canonical province, coordinate quality where useful, and no result. Record provider chargeable units, latency, timeout, and retries. Run manual-only, provider-error, and correction cases through Waitron's actual validation. Add each later country separately after its country pack permits setup. This is an **evaluation plan**, not measured quality.

The owner must set sample size and regional weights, acceptable normalization, accuracy thresholds, cache duration, attribution placement, and a peak-day budget. Proposed initial gates for discussion are 95% selectable matches among in-scope Spanish cases, 98% correct postcode and administrative area among selections, zero silent country switches or overwritten manual edits, and all accepted results passing Waitron server validation with the expected fiscal territory and time zone. Do not average an unsupported region's failure into a national pass. Before provider selection, obtain written permission or a reviewed contract basis for permanent merchant-field storage and display, plus the chosen endpoint's processing, rate, and price terms. The selected provider, allowance, and implementation remain open until those receipts and the benchmark exist.

## Measured on Spain, 2026-10-16

You can compare the services on a small, deliberately difficult set of civic addresses.
This measures the returned fields under the adapters below. It does not select a provider
or establish permission to keep its address content. Google's results are a quality
comparison only; its durable merchant-record storage rights remain unresolved.

The [corpus](evaluations/spanish-addresses.json) contains 20 public civic addresses and
one hand-authored input variant for each. Its original queries and annotations are
released under CC0-1.0. Each address fact names its independent municipal source;
no provider supplied the expected answers. The corpus was fixed before authenticated
requests, with SHA-256 `1a19d695c2f5d4ecd4328e05f438adf42ca3d7796cbf8b7988f10add132d6bd9`.
The weights are runner defaults, not a population sample: 28 mainland cases (70%),
eight island cases (20%), and four Ceuta/Melilla cases (10%). Eight cases cover
small towns. The variants include accents, Spanish and local-language names,
abbreviations, typos, ambiguous streets without a locality, conflicting postcodes,
and two fictional units. The units test whether a detail survives, not whether it exists.

Each service receives the same original query, restricted to Spain. Geoapify's
EU endpoint is tested twice, as autocomplete and forward geocoding, with the same input.
Google Places Autocomplete (New) supplies the first prediction, whose text is sent to
Address Validation; no expected answer is used to pick a prediction. These two calls
are separate requests without a session token, so this is not a session-billing test.
CartoCiudad supplies its first candidate and resolves that exact ID with `find` only
when the candidate lacks point coordinates. See the [Geoapify API](https://apidocs.geoapify.com/docs/geocoding/address-autocomplete/),
[Google autocomplete API](https://developers.google.com/maps/documentation/places/web-service/place-autocomplete),
[validation request format](https://developers.google.com/maps/documentation/address-validation/requests-validate-address),
and [CartoCiudad service contract](https://github.com/IDEESpain/Cartociudad#-b%C3%BAsqueda-por-nombre-geogr%C3%A1fico).

A selectable match means that the first result has the expected street, locality,
and returned Spanish country code. This is an editable street-level suggestion;
it does not mean every component is correct or that Waitron has accepted the address.
Accents, case, punctuation, and articles are ignored; language translations require an
explicit corpus alias. House numbers and postcodes compare exactly. A wrong street,
locality or country counts as a wrong match. A missing component fails its field check.
This adapter treats Geoapify's `county`, Google's `administrative_area_level_2`,
and CartoCiudad's `province` as candidate province fields. A county can instead be
a comarca, a smaller regional division; these fields are not interchangeable
proof of a canonical province. The comparison does not guess a province from a postcode.
A missing country remains unknown; a filter is not evidence that the result returned
its country. CartoCiudad's documented `011` country code maps to ES.

The proposed 95% selectable gate uses all 28 in-scope cases, including errors and no
results, as its denominator. The proposed 98% postcode-and-province gate uses only
street-level selections. The 12 cases in unsupported fiscal areas (Canaries,
Basque Country, Navarra, Ceuta and Melilla) are reported separately. These scope
flags follow Waitron's country pack at the recorded validation commit below.
Neither threshold has been approved as a release promise.

The [offline checks](../scripts/ci-address-lookup-evaluation.test.mjs) run with
`node --test scripts/ci-address-lookup-evaluation.test.mjs`. They are included in the
existing CI root-check filename pattern. The [measurement harness](../scripts/address-lookup-evaluation.mjs)
requires `--run google`, `--run geoapify`, or `--run cartociudad` to send requests.
It reads the hosted keys at runtime from `~/.waitron-address-lookup/env`. Its fixed
item-wide journal is `~/waitron-campaign-d/receipts/d75/requests.jsonl`; do not reset
it to repeat a measurement. An exclusive lock prevents simultaneous runs, and every
attempt is saved and flushed to disk before dispatch. A crash after reservation
still consumes that request. The counter refuses request 1,500, so each provider
stays below the authorised 1,500-request ceiling. Requests start at least 1.1 seconds
apart in the sequential corpus runner, including a restart using the journal's last
reservation time. The HTTP deadline covers headers and body for 15 seconds. There
are no automatic retries or redirects. A crash may repeat an unfinished case; each
case/operation permits at most two attempts in total, and receipts count those
repeat reservations as retries. A request or attempt limit stops the run without
writing provider-error scores for unsent cases, and its final receipt still records
the counters. The item-wide Geoapify ceiling is also below its 3,000/day
allowance, though this cannot account for unrelated use of the same key.

Only the corpus, harness and per-case scores are committed. Raw responses remain in
the local lane receipts until landing and are then deleted. Saved response URLs lose
their query strings, credentials are redacted, and error receipts use fixed labels
rather than transport exceptions that might contain a key. Request counts are
conservative HTTP-attempt bounds, not invoices or a measurement of session discounts.

### Results under this mapping

The [per-case scores](evaluations/spanish-address-scores.jsonl) contain booleans and
request measurements, with no returned address text. The [machine-readable totals](evaluations/spanish-address-summary.json)
use the same corpus digest. The CartoCiudad adapter initially treated its full display
label as a street component; an offline failing fixture exposed the duplicate street
type, house number and locality. The corrected parser was applied to the saved responses
without new requests or changes to expected answers. All final scores were replayed
against the recorded request order.

| Flow, 28 supported cases | Selectable | Wrong match | Exact number | Postcode | Locality | Province | No result / error | Postcode and province among selections |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Geoapify autocomplete | 17/28 (60.7%) | 10 | 25 | 16 | 21 | 12 | 1 / 0 | 8/17 (47.1%) |
| Geoapify forward geocode | 18/28 (64.3%) | 10 | 25 | 19 | 24 | 11 | 0 / 0 | 8/18 (44.4%) |
| Google autocomplete then validation, quality comparison only | 22/28 (78.6%) | 4 | 23 | 22 | 23 | 23 | 1 / 1 | 21/22 (95.5%) |
| CartoCiudad first candidate | 3/28 (10.7%) | 7 | 7 | 7 | 6 | 7 | 18 / 0 | 3/3 (100%) |

No flow reaches the proposed 95% selectable gate. CartoCiudad's component gate passes
on only three selections, which is too little evidence for a choice. Google returned
one HTTP 500 for the A Coruña base case; it remains an error in the denominator.
A correct house number on the wrong street still counts in the separate number
column, so that column must not be read as the number of correct complete addresses.

| Flow, 12 unsupported cases | Selectable geographically | Wrong match | Exact number | Postcode | Locality | Province | No result / error |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Geoapify autocomplete | 8 | 3 | 8 | 10 | 10 | 8 | 1 / 0 |
| Geoapify forward geocode | 9 | 3 | 10 | 9 | 12 | 9 | 0 / 0 |
| Google autocomplete then validation | 11 | 1 | 9 | 12 | 12 | 8 | 0 / 0 |
| CartoCiudad first candidate | 3 | 1 | 4 | 3 | 4 | 4 | 8 / 0 |

A geographically correct unsupported address still cannot enable its fiscal territory.
The mapped unit/floor field matches none of the two fictional units and the published
Pamplona floor (0/3 per flow). CartoCiudad always maps its unit to null in this adapter,
so its zero measures an adapter limit, not the provider's unit content. Geoapify uses
`unit` and Google uses `subpremise`; labels and other component types are not searched
for unit details. Keep the original unit text available for review; actual form
preservation remains untested.
No measured returned country switched outside Spain, and no nonempty result lacked
a country code. That does not prove a product guard against a future country switch.
The offline fixtures independently refuse a foreign-country suggestion.

| Provider | Corpus HTTP attempts | Item counter / 1,499 | Median / 95th percentile per request | Timeouts | Retries |
| --- | ---: | ---: | ---: | ---: | ---: |
| Geoapify EU, both endpoints | 80 | 80 / 1,499 | 1,954 / 6,522 ms | 0 | 0 |
| Google, both APIs | 78 | 78 / 1,499 | 121 / 226 ms | 0 | 0 |
| CartoCiudad | 40 | 41 / 1,499 | 288 / 521 ms | 0 | 0 |

CartoCiudad's extra counter reservation is a failed browser documentation probe before
the harness run; its dispatch is counted conservatively and has no latency sample.
Every nonempty live CartoCiudad candidate already had coordinates, so `find` is covered
by offline fixtures, not this live sample. Geoapify ran from 16:08:26 to 16:12:13 UTC,
Google from 16:12:18 to 16:13:43, and CartoCiudad from 16:14:01 to 16:14:46.
The latency percentiles include the failed Google attempt, exclude the deliberate
spacing between calls, and use the nearest ranked observation. They are one Mac's
network measurements, not a service commitment or a load test.

The actual Waitron country-pack functions at commit
`ce02b95d7d626d37db61ae2281629beb28247e4d` accepted all 40 expected postcodes,
resolved their expected provinces and agreed with all fiscal-scope flags. A manual
`28014`, malformed `2801`, and corrected `28015` check returned valid, invalid and
valid respectively. The source bundle was built with the Cloud fixture's esbuild,
and its source tree matched that Waitron commit. This checks the expected data and
country functions. It does not submit provider output through the setup server or
exercise an editable form: no provider integration exists for that test. Manual-only,
provider-error and correction journeys through the real setup server/UI remain a
separate integration acceptance requirement, including fiscal territory, time zone
and protection of manual edits.

Keep manual entry and run a second, explicitly scoped comparison before choosing.
These are 20 civic sites with paired variants, not 40 independent homes or venue
addresses. The first-result rule is stricter than a person choosing from several
suggestions. Two queries deliberately omit their locality, and three deliberately
supply a conflicting postcode. CartoCiudad returned no result for many complete
postcode-bearing inputs; these scores do not show how a separately normalized query
would perform. Missing or differently divided administrative fields count against
this conservative adapter, so these are mapping results rather than an independent
survey of geographical coverage. Coordinates were not checked against independent
surveyed points. No result measures peak-day capacity, keystroke traffic, session
cost, storage permission, cache rights, or attribution placement.

The owner approved the [second residential/rural comparison](#residential-and-rural-comparison-2026-10-16)
on 2026-10-16. The first benchmark remains frozen. Confirm durable
merchant storage and display rights before recommending a provider. Provider choice,
release thresholds, cache lifetime, attribution placement, account allowance and
sharing rules, and the peak-day budget remain owner decisions.

## Residential and rural comparison, 2026-10-16

A person can choose from several suggestions, and a returned postcode can supply a
province even when the provider names a comarca instead. The next comparison measures
those differences explicitly. Keep manual entry available while you assess the results.
It approves no provider, product normalization rule, storage right or release threshold.

The [second corpus](evaluations/spanish-residential-addresses.json) fixes 60 public
street addresses before requests. Thirty are registered tourist homes in Catalunya;
thirty are registered rural lodgings in Castilla y León. Each has an unchanged query
and a second query without its original postcode, for 120 cases. The register supplies
the reference street, number, locality, postcode and province. No provider supplies
an expected answer. Floor, unit, owner, contact and cadastral fields are excluded.
These are tourist homes and rural lodgings, rather than a representative household
sample. Register mistakes remain possible; coordinates are not independently surveyed.

You can trace each address to its original record ID, selected fields and public API
URL. Catalunya contributes eight addresses each from Barcelona and Girona and seven
each from Lleida and Tarragona. Castilla y León contributes four each from Ávila,
Burgos and León and three each from its other six provinces. This deliberate regional
sample does not estimate national, island or unsupported-territory performance. The
first civic benchmark remains unchanged and separate. Its paired variants and this
corpus's paired queries are not independent addresses.

Sources and attribution: Generalitat de Catalunya, Departament d'Empresa i Treball,
[tourism register](https://analisi.transparenciacatalunya.cat/Turisme/Establiments-d-allotjament-tur-stic-inscrits-al-Re/t2h3-cgys),
under the portal's [open-use terms](https://web.gencat.cat/ca/generalitat/dades-indicadors/dades-obertes/llicencies);
and Junta de Castilla y León, Consejería de Cultura, Turismo y Deporte,
[tourism register](https://analisis.datosabiertos.jcyl.es/explore/dataset/registro-de-turismo-de-castilla-y-leon/),
whose metadata names CC BY 4.0. Both were read on 2026-10-16. Address fields are
selected and reformatted, Spanish street-type aliases are added explicitly, and
postcode-free queries are derived from the original input. The corpus records the
selection order and exclusions. Its distinct-street check compares literal labels,
so cases 003 and 004 retain two different numbers on the same street despite a
spelling variation. The corpus remains frozen, including that wording. It does not relicense the source records as CC0.

### Fixed evaluation rules

Send both queries separately, without automatic fallback or correction. Removing a
postcode tests query sensitivity; it never fills a missing returned postcode or changes
the expected answer. Exact postcode accuracy always compares the returned value with
the independent register reference. Both arms retain the same street number and locality.

Resolve province evidence through the [frozen country-pack table](evaluations/spanish-provinces.json).
It records all 52 province names, codes and aliases from Waitron commit
`39d07827e18658c671bfd3e9661dde065fc973c9`. A recognized supplied province is
canonicalized. Otherwise, a valid returned Spanish postcode can supply its province;
report this as inference, separately from supplied evidence. A recognized province
that conflicts with that postcode refuses a complete draft. Unknown comarca names
are not provinces. Neither the input postcode nor the expected answer supplies missing
provider fields. Missing or foreign countries remain unaccepted.

Score every result among the first five, in provider order. Google validates each
prediction separately, including incorrect predictions. CartoCiudad resolves only the
exact ID and type of each candidate without coordinates. Geoapify returns its own
bounded list for each endpoint. Expected answers are used only to score every result,
never to decide which result gets another request.

Report first-result matches and the presence of a matching address anywhere in that
list separately. List presence is an answer-aware upper bound on what a person could
select; no person or product has selected that address. A complete draft requires the
same candidate to match street, locality, country, house number, postcode and canonical
province, with no province conflict. A correct number on another candidate cannot
complete a wrong street. This is stricter than the original street-level selection
metric, which remains available for comparison. Neither metric proves that the actual
Waitron setup server or editable form accepts and preserves a suggestion.

### Reproduce the bounded comparison

Run the offline checks with:

```sh
node --test scripts/ci-address-lookup-comparison.test.mjs scripts/ci-address-lookup-evaluation.test.mjs
```

The [comparison harness](../scripts/address-lookup-comparison.mjs) requires an explicit
`--run google`, `--run geoapify` or `--run cartociudad` to make requests. It shares the
original D75 request journal and its exclusive lock, cumulative 1,499 ceiling,
pre-dispatch disk flush, two-attempt limit, spacing and HTTP deadline. It writes its
scores and temporary raw responses under `~/waitron-campaign-d/receipts/d76/`.
Do not reset the shared journal to repeat either benchmark. Initial cumulative counts
are Google 78, Geoapify 80 and CartoCiudad 41. At most 720, 240 and 720 additional
requests respectively are needed, including every possible list-resolution request.
No automatic retry is enabled. The preflight counts only unfinished cases when resuming;
every actual attempt still reserves its allowance before dispatch.


### Results under the fixed reference fields

The corpus SHA-256 is
`93db903d386e727bef5094d56312b62ac3558df7b199f3f44be9b95791a32e68`.
The [360 per-case score rows](evaluations/spanish-residential-address-scores.jsonl)
and [complete totals](evaluations/spanish-residential-address-summary.json) retain
booleans, ranks and request measurements. Saved responses reproduce every score and
the exact query and candidate identities without another provider request. The final
error-handling corrections do not change these scores: all measured requests and
candidates succeeded. Each denominator below is 60 queries, one per distinct address.

**Original postcode retained**

| Flow | First street match | Match in list | First complete draft | Complete draft in list | No result |
| --- | ---: | ---: | ---: | ---: | ---: |
| Google, quality only | 47 | 48 | 47 | 48 | 3 |
| Geoapify autocomplete | 37 | 40 | 33 | 36 | 0 |
| Geoapify geocoding | 40 | 42 | 38 | 40 | 0 |
| CartoCiudad | 0 | 0 | 0 | 0 | 60 |

**Original postcode omitted**

| Flow | First street match | Match in list | First complete draft | Complete draft in list | No result |
| --- | ---: | ---: | ---: | ---: | ---: |
| Google, quality only | 46 | 48 | 46 | 48 | 2 |
| Geoapify autocomplete | 37 | 39 | 33 | 37 | 6 |
| Geoapify geocoding | 40 | 41 | 36 | 38 | 0 |
| CartoCiudad | 15 | 16 | 1 | 1 | 42 |

Google has the same 48 addresses with a complete draft somewhere in the list under
both queries. Geoapify autocomplete has 35 in both arms, one only with a postcode and
two only without it. Geocoding has 38 in both arms and two only with a postcode.
CartoCiudad has one complete draft, only without a postcode. It returns no candidates
for any of these postcode-bearing queries. Removing postcodes therefore helps this
CartoCiudad query shape, but does not establish a general normalization rule or a
complete address service. Among its 73 street-matching candidates across 16 queries, only one has the
reference house number; all 73 have the reference postcode and province. Individual
first-result wrong-match, number, postcode, locality, province and country counts
for both query arms are also retained in the machine-readable totals.
Every returned CartoCiudad candidate already has coordinates, so its `find` calls
remain covered offline rather than measured here. Its 88 returned postcode fields
are strings; this does not establish the type of every possible response.

**Complete drafts available in the list, by cohort; each cell is out of 30 addresses**

| Flow | Homes, postcode | Rural, postcode | Homes, omitted | Rural, omitted |
| --- | ---: | ---: | ---: | ---: |
| Google, quality only | 23 | 25 | 23 | 25 |
| Geoapify autocomplete | 21 | 15 | 22 | 15 |
| Geoapify geocoding | 24 | 16 | 24 | 14 |
| CartoCiudad | 0 | 0 | 0 | 1 |

These figures depend on the locality field. Catalunya's reference is a municipality;
Castilla y León's is a village. In 13 rural addresses, or 26 paired cases, the village
and municipality differ. A provider naming the municipality can therefore fail a
reference that names its village, even when other components match. Conversely, the
Catalan reference can reject a more specific village. This is a field-mapping result,
not a count of addresses that a provider cannot locate.

A separate [offline sensitivity check](evaluations/spanish-residential-locality-sensitivity.jsonl)
allows either of the rural register's independently published locality fields. It
changes no original reference, query, request or baseline score. With a postcode,
Geoapify autocomplete's complete-list count changes from 36 to 38, and geocoding's
from 40 to 47; without a postcode they change from 37 to 41 and from 38 to 45.
Google stays at 48 in both arms; CartoCiudad stays at zero and one. This is a stated
alternative evaluation rule, not approval to put a municipality into the product's
city field. No independent village aliases are available in the Catalan reference,
so that side of the hierarchy remains unmeasured. Decide the accepted locality level
before choosing a provider or treating these figures as geographical accuracy.

**Province evidence across all returned candidates in both query arms**

| Flow | Candidates | Correct supplied province | Computed from returned postcode | Unrecognized supplied label |
| --- | ---: | ---: | ---: | ---: |
| Google, quality only | 165 | 159 | 0 | 0 |
| Geoapify autocomplete | 305 | 201 | 83 | 85 |
| Geoapify geocoding | 255 | 143 | 90 | 93 |
| CartoCiudad | 88 | 88 | 0 | 0 |

These are candidate counts, including wrong street matches, rather than selected
addresses or comparable accuracy rates. An unrecognized label can coexist with
postcode inference, so the columns do not add up. A computed province need not be
the expected province; a complete draft still requires the expected value. All 813
candidates return Spanish country evidence. None has a recognized province/postcode
conflict. Offline tests independently refuse missing/foreign countries and conflicts;
this sample does not prove a future product guard.

The actual Waitron country pack at the frozen commit accepts all 120 reference
postcodes, their provinces, supported fiscal areas and Madrid time zones. The 280
complete candidate drafts also pass those component checks against that pack.
This does not submit provider output through the actual setup server or form. Manual
entry, correction, field preservation and fiscal/time-zone acceptance through that
journey remain integration requirements. No unit, floor, independent coordinate,
keystroke-traffic, session-discount or peak-capacity claim follows from this run.

### Requests and remaining decisions

| Provider | Additional HTTP attempts | Cumulative / 1,499 | Median / 95th percentile per request | Errors / timeouts / retries |
| --- | ---: | ---: | ---: | ---: |
| Google | 285 | 363 / 1,499 | 118 / 186 ms | 0 / 0 / 0 |
| Geoapify | 240 | 320 / 1,499 | 1018 / 4612 ms | 0 / 0 / 0 |
| Cartociudad | 120 | 161 / 1,499 | 434 / 626 ms | 0 / 0 / 0 |

Google uses 120 autocomplete and 165 validation attempts; Geoapify uses 120 per
endpoint; CartoCiudad uses 120 candidate requests. These are HTTP-attempt bounds,
not invoices or session-billing measurements. Geoapify runs from 17:10:00 to
17:17:33 UTC, Google from 17:17:48 to 17:23:03 and CartoCiudad from 17:23:27 to
17:25:41. Latencies exclude spacing and describe this Mac's network only. Temporary
raw responses stay local until landing, when they are deleted. No customer data or
provider address text is committed in the scores.

Keep manual entry. The strict street-list result remains below the proposed 95%
gate for every flow, including the stated rural-municipality alternative. The
sample still has concentrated geography: Barcelona contributes one city, Girona
three neighbouring villages, and Lleida and Tarragona four municipalities each.
Register spelling remains literal, including the `GENERAL SANJUJO` reference.
The Catalunya dataset metadata says only “See Terms of Use”; its licensing basis
here is the portal default, rather than a dataset-specific permission receipt.
Different references and province/selection rules make these figures unsuitable
for claiming an improvement over the first benchmark's percentages.

Next, settle the locality level and verify durable merchant-field storage and display
rights before selecting a provider. Google remains a quality comparison only.
Release thresholds, cache lifetime, attribution placement, account allowance and
sharing, and the peak-day budget remain owner decisions. The harness adds no product
route, automatic field replacement or provider selection.
