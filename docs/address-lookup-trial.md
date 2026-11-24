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
same house number and postcode. The field-only receipt cannot distinguish an
unlisted spelling from a change to the street. Four cases had other mismatches
without a street mismatch: two localities, one postcode and locality, and one
missing province.

| First-choice result | Cases out of 40 |
| --- | ---: |
| Every field right on strict comparison | 22 |
| Every field right after accepting equivalent street spellings | 11 more |
| First choice still wrong | 7 |
| Wrong first choice recovered by a second or third suggestion | 1 of the 7 |

**33 of 40 first choices scored as complete** across the strict and spelling
checks. The spelling checks used fresh suggestions and validation replies. For
six cases, they confirmed the street and house number while the earlier strict
pass supplied the other field scores. Both lists checked at positions two and
three had a complete third choice. One of those rescued a wrong first choice.

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

For a local rehearsal, inject a fake provider with `addressLookup: {provider, allowAllTestBoxes: true}`.
Mark it with `[syntheticAddressProvider]: true` from `packages/account-http/src/address-lookup.ts`
and publish a test allowance. Cloud counts against the verified current owner of the
registered test box. After an ownership transfer, start a fresh workflow.

```sh
node scripts/test-postgres.mjs exec node --test packages/account-http/test/address-lookup.test.ts
```

The normal server and shared test Cloud keep lookup disabled. This Mac trial
made its calls directly through the client. The signed route and Waitron form
integration are separate checks.

A private launcher can inject `createTestBoxAddressLookup` with one approved
`{accountId, venueId, installationId}` in `addressLookup.allowedBoxes`. It reads
`GOOGLE_MAPS_SERVER_KEY` per call from a regular, server-owned mode-0600 file.
Removing the file prevents further sends. Admission still counts a workflow when
the key is missing, and validation still closes it. The [key-file tests](../packages/account-http/test/test-box-address-lookup.test.ts)
cover removal, replacement and refusal with synthetic replies.

## Sign each request through the box's existing connection

POST `/api/installations/address-lookup` with the existing machine-v1
`{payload,signature}` envelope, action `address-lookup`, a fresh per-call
`operationId` and a live matching installation lease. Use no browser Origin
header, URL query, account selector or provider key. The normal installation
proof format is described in the [integration contract](waitron-integration-contract.md#existing-staff-v1-compatibility-facts).

Generate one lowercase UUID `workflowId` for the address you are looking up.
Sign a JSON.stringify body such as:

```json
{"version":1,"kind":"suggest","workflowId":"123e4567-e89b-42d3-a456-426614174001","query":"Calle de Prueba 12, Madrid","language":"es"}
```

A successful reply contains that `workflowId`, an ISO `expiresAt`,
`provider: "google"` and `candidates: [{"text":"…"}]`. Only `es` and `en` are
accepted; suggestions are restricted to Spain. If the first reply is lost, keep
its workflow ID and send a fresh operation ID. That reuses the same allowance
hold, but another suggestion attempt still counts. Cloud refuses an operation ID
it has already consumed. Each admitted request makes at most one provider attempt.

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
address the person sees. Cloud stores counts and discards queries and drafts.

## Keep the trial bounded

A Cloud account gets ten counted workflows per UTC month, eight suggestion attempts
per workflow and twenty per UTC day. A workflow expires after fifteen minutes or at
the UTC month boundary. Abandoning it still counts. Validation closes it before the
provider call, so an uncertain validation cannot be resent. The stack shares one
dispatch lock with a 500 ms gap. A concurrent request gets 409 without using quota. A crash can shorten the gap.

| Refusal | What you do |
| --- | --- |
| 400 invalid input | Correct the body; no provider attempt occurred. |
| 401 invalid proof, 403 revoked or permission denied | Restore the box's current authority. |
| 409 conflict | Use manual entry or a fresh call; closed workflows stay closed. |
| 410 expired | Start a new workflow; the old hold remains counted. |
| 429 rate limited | Keep manual entry available and respect Retry-After. |
| 503 unavailable | Keep manual entry available; do not automatically resend. |

Provider errors include `dispatched`. True means a request was attempted, not
that Google is known to have billed it. Missing allowance configuration, disabled
injection, lost authority and failed admission do not enable a provider call.
