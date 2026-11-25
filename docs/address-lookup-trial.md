# Try address suggestions

## What the Mac trial measured

On 24 November 2026, the trial used Cloud’s Google client on a Mac. It asked for suggestions once per public address,
validated the first choice and compared every editable field with the independent
reference. It counted street and house number together as line 1. Case and spacing
were normalized, alternate spellings had to be listed before the run, and postcodes
had to match exactly. The 40 cases included 10 restaurants or shops, 6 registered
flats, 8 rural lodgings and 16 civic addresses including the Canaries and Ceuta.
Half of the queries omitted the postcode. The flat references cover the street
entrance. They have no apartment or floor numbers to check.

| Pass | Cases | Every field right | Draft with a mismatch | No draft | Suggest / validate |
| --- | ---: | ---: | ---: | ---: | ---: |
| First pass | 40 | 16 | 8 | 16 | 40 / 40 |
| Repeat the failed cases after the mapping fixes | 24 | 6 | 18 | 0 | 24 / 24 |
| Last result after the first two passes | 40 | 22 | 18 | 0 | 64 / 64 total across both passes |

The synthetic tests reproduce refusals for Spanish country names in Catalan and
Basque, and missing street and province fields when Google supplies them in its
structured postal address. The repeat pass produced drafts for all 16 cases that
had returned none. Its strict score recorded 14 street mismatches, 6 locality
mismatches, 2 postcode mismatches and 1 missing province. A draft can have more
than one mismatch. In Spain, Google uses the postal administrative area for the
province. [Google Address Validation reference](https://developers.google.com/maps/documentation/address-validation/reference/rest/v1/TopLevel/validateAddress#PostalAddress)

The follow-ups rechecked all 14 street mismatches against the reference. Twelve
had the same street and house number once spelling and formatting were normalized.
One of those drafts still had a locality mismatch. One first choice led to a
different street, locality and postcode. Another first choice named the expected
street, but validation returned a street outside the reference spellings at the
same house number and postcode. The earlier strict score also flagged its
locality. The field-only receipt leaves the street difference unresolved. Four
other cases had a mismatch outside the street line. Two had a wrong locality,
one had a wrong locality and postcode, and one lacked a province.

| Trial result | Cases |
| --- | ---: |
| Every field right on strict comparison | 22 |
| Every field right after accepting equivalent street spellings | 11 more |
| First choice still wrong | 7 |
| Wrong first choice recovered by the third suggestion | 1 |
| Other wrong first choices checked only at position one | 6 |

The strict score was **22 out of 40**. The spelling checks identified 11 more
complete cases by allowing accents, punctuation, articles, equivalent street
types and number order while requiring the same house number. Those checks
used fresh suggestions and validation replies. For six cases, they confirmed the
street and house number while the earlier strict pass supplied the other field
scores. Both lists checked at positions two and three had a complete third
choice. One of those rescued a wrong first choice.

The final adapter preserves the structured street when the postal line names a
different one. The first two passes recorded no draft that had a structured
street with a missing number component, the case affected by that review fix.

The first two passes ran at 20:26–20:28 UTC and used 128 requests. The follow-ups
at 21:18 and 21:22 UTC used 40 more, ending at 168 of the 170 authorized calls
(86 suggestion and 82 validation requests). All passes omitted the Google session
token. The owner’s billing report for 16 October and 24 November is needed to
confirm the billing category for validation without a session token.
[Google’s session pricing](https://developers.google.com/maps/documentation/places/web-service/session-pricing)

The [civic](evaluations/spanish-addresses.json) and [tourism-register](evaluations/spanish-residential-addresses.json)
references supply 30 cases. The other street references come from [Botín](https://botin.es/en/contacto-botin/),
[Casa Lucio](https://casalucio.es/contacto/), [Lhardy](https://lhardy.com/contacto/),
[Mercado de San Antón](https://www.esmadrid.com/compras/mercado-de-san-anton),
[7 Portes](https://7portes.com/es/7-portes-restaurant/localizacion-y-contacto/),
[Can Culleretes](https://culleretes.com/es/contacto/), [Arzak](https://www.arzak.es/en/contact-us/),
[Akelarre](https://akelarre.net/en/contact-and-location/), [Casa Carmela](https://www.casa-carmela.com/es/aviso-legal/)
and [El Rinconcillo](https://www.elrinconcillo.es/contacto/).

## Test the signed route

Run the signed test route against PostgreSQL and a simulated provider:

```sh
node scripts/test-postgres.mjs exec node --test packages/account-http/test/address-lookup.test.ts
```

Eligible test boxes can look up addresses at the same time. Cloud gets the owner
from the registered box. Start a fresh workflow after an ownership transfer.
Lookup is off by default. The configured service is available only to registered
test boxes. The [test Cloud settings](test-cloud.md#configure-address-lookup-for-test-boxes)
explain how to enable it for an approved rehearsal. The Mac trial above called
the provider directly. The four Waitron forms still need their connected-box check.

## Sign each request through the box's existing connection

POST `/api/installations/address-lookup` with the existing machine-v1
`{payload,signature}` envelope, action `address-lookup`, a fresh per-call
`operationId` and a live matching installation lease. Use no browser Origin
header, URL query, account selector or provider key. The normal installation
proof format is described in the [integration contract](waitron-integration-contract.md#existing-staff-v1-compatibility-facts).

When the form opens, send the signed body `{"version":1,"kind":"available"}`.
Show search when Cloud returns HTTP 200 with `{"available":true}`. This request uses
the ordinary installation request limits. It uses no address allowance and sends
nothing to Google. Keep manual entry available on any other reply.

Generate one lowercase UUID `workflowId` for the address you are looking up.
Sign a JSON.stringify body such as:

```json
{"version":1,"kind":"suggest","workflowId":"123e4567-e89b-42d3-a456-426614174001","query":"Calle de Prueba 12, Madrid","language":"es"}
```

A successful reply contains that `workflowId`, an ISO `expiresAt`,
`provider: "google"` and `candidates: [{"text":"…"}]`. Only `es` and `en` are
accepted; suggestions are restricted to Spain. If the first reply is lost, keep
its workflow ID and send a fresh operation ID. Each admitted suggestion counts,
including one you abandon. Cloud refuses a repeated operation ID and sends at
most one provider request per admitted call.

When you choose a suggestion, sign:

```json
{"version":1,"kind":"validate","workflowId":"123e4567-e89b-42d3-a456-426614174001","selectedText":"Calle de Prueba 12, Madrid"}
```

The reply contains `workflowId`, `expiresAt`, `provider` and editable `fields`:
`addressLine1`, nullable `addressLine2`, `postalCode`, `city`, `province` and
`countryCode: "ES"`. Missing fields are empty strings, except null line 2. Province
is Google's label; resolve it through your country pack and keep your existing
server checks. A draft is not a saved or fiscally accepted address.

Keep manual text editable and show Google Maps attribution. Choosing a suggestion
starts validation. Keep every field visible and editable so **Save** confirms the
address the person sees. Cloud records the call type, time, paid or free class,
and the account, venue, box, workflow and operation IDs for its limits. Queries
and drafts are discarded.

## How the limits work

A workflow lasts fifteen minutes from its first admitted suggestion. It allows
one validation. Cloud charges a call before sending it, so a failed or uncertain
provider reply still counts. A suggestion needs room for one validation as well.
Another workflow can use that room first.

Alongside the configured venue or owner allowance, the test service applies daily
and monthly spend caps for all requests and a separate share for free accounts.
Daily and monthly periods start at midnight in Pacific time. Lookup attempts,
including refusals, have separate per-minute limits of 30 per box, 60 per network
and 60 per owner. Cloud charges the owner’s counter after the box’s check passes.

| Refusal | What you do |
| --- | --- |
| 400 invalid input | Correct the body; no provider attempt occurred. |
| 401 invalid proof, 403 revoked or permission denied | Restore the box's current authority. |
| 409 conflict | Use manual entry or a fresh call; closed workflows stay closed. |
| 410 expired | Start a new workflow. Earlier calls stay counted. |
| 429 rate limited | Keep manual entry available and respect Retry-After. |
| 503 unavailable | Keep manual entry available; do not automatically resend. |

Provider errors include `dispatched`. `true` means Cloud attempted the request.
Google billing is reported separately. Cloud sends nothing when settings or the
key are missing, the box loses authority, or admission fails.

## Stop or resume a test venue

In the LAN action demo, sign in as the configured operator and open
`/operator/actions`. Under **Address lookup**, enter the test venue ID, then
choose **Stop lookup** or **Resume lookup**. A fresh verification is required.
Once you stop the venue, new availability checks and lookups are refused. Calls
already admitted can finish. Resuming preserves the venue's usage.

The Amazon test Cloud has no operator screen for this. To stop a venue there,
run this in the account database, replacing the example ID with the test venue's ID.

```sql
INSERT INTO address_lookup_stopped_venues (venue_id) SELECT id FROM venues WHERE environment = 'test' AND id = '11111111-1111-4111-8111-111111111111' ON CONFLICT DO NOTHING;
```

Delete that venue's row to resume. To stop lookup for every test box, unset
`CLOUD_ADDRESS_LOOKUP_SETTINGS` and restart the account worker.

The first refusal for a cap and period writes the cap and period to the account
log. When a verified operator is configured, it also queues one warning for the
same cap and scope. Shared caps cover either all lookups or all free accounts.
An own-cap warning includes the affected venue ID. A venue that stops exactly
at its limit sends no warning. The LAN action demo captures the email in its
private inbox. A deployment needs an operator and a qualified relay to send it.

The account worker checks for old call records every minute. It deletes up to
1,000 per pass once they belong to a previous Pacific calendar month and are
more than 30 minutes old. That short overlap lets near-midnight lookups finish
without reopening an expired search.
