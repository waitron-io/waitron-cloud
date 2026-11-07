# Try address suggestions on the owner's test box

You can test one paired box against a signed Cloud address route. Normal
installations keep manual entry: this trial needs an explicitly injected provider
and one configured Cloud account, venue and installation. The normal server and
test deployment do not enable it or accept a Google key. The private launcher can
inject the file-backed provider below after the watcher receives the server-only
key and the owner confirms usage and quotas. This is not the production address service.

The owner approved this trial in A951-S step 5 on 6 November 2026. The watcher’s
7 November 00:47 and 01:05 decisions choose counted abandonment and the small
single-box limits below. Its 01:47 clarification keeps activation limited to the
server-only key, the owner’s usage/quotas confirmation and allowance configuration
for this account. Removing the key file is the trial’s stop control. The broader [scope](address-lookup-scope.md) still owns
provider terms, permanent address storage and the eventual service.

## Inject the private provider

In the private launcher, import `createTestBoxAddressLookup` from
`packages/account-http/src/test-box-address-lookup.ts`. Pass its result as
`addressLookup.provider` to `startAccountServer`, alongside the single approved
`accountId`, `venueId` and `installationId`. Use
`{keyFile:'/trial-address/google.env',fetcher:fetch}`; mount the server's
`/root/waitron-address` directory read-only at `/trial-address`. Mount the directory
so removing or replacing the original file remains visible inside the server.

The provider reads `GOOGLE_MAPS_SERVER_KEY` for each call. The file must be a regular
file that is not a symbolic link, owned by the server's user, mode 600 and at most 8192 bytes. A missing
or invalid file returns `unavailable` with `dispatched:false`. Removing the original
key file prevents later dispatch; it cannot recall a request already sent. Run
`node --test packages/account-http/test/test-box-address-lookup.test.ts` to check
key removal, replacement and refusal using synthetic transport replies. Signed
requests still consume allowance and request limits before reading the key file;
validation closes its workflow even if the key is missing. Keep manual entry
available and do not retry automatically while the trial is stopped.

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
hold, but another suggestion attempt still counts.

When you choose a suggestion, sign:

```json
{"version":1,"kind":"validate","workflowId":"123e4567-e89b-42d3-a456-426614174001","selectedText":"Calle de Prueba 12, Madrid"}
```

The reply contains `workflowId`, `expiresAt`, `provider` and editable `fields`:
`addressLine1`, nullable `addressLine2`, `postalCode`, `city`, `province` and
`countryCode: "ES"`. Missing fields are empty strings, except null line 2. Province
is Google's label; resolve it through your country pack and keep your existing
server checks. A draft is not a saved or fiscally accepted address.

Keep manual text editable and show Google Maps attribution. Public terms/privacy
links belong to the public service and do not gate this private trial. Choosing a
suggestion starts validation; ask for separate
whole-address confirmation before saving the person's confirmed or corrected
fields. Discard drafts on exit or expiry. Cloud saves no query, address, response
or address-derived fingerprint and returns no coordinates, place ID or confidence.

## Keep the trial bounded

You get ten workflows per Cloud account per UTC month, eight suggestion attempts
per workflow and twenty per UTC date. A workflow lasts at most fifteen minutes
and ends at the UTC month boundary. Opening it reserves one existing address
allowance unit; abandoning or expiring it does not release that unit in this trial.
Validation spends and closes the workflow before its one provider attempt.
An uncertain validation cannot be submitted again. Remove this counted-abandonment
exception when the real service is scoped.

A shared nonblocking lock refuses busy callers without spending quota. Each admitted
request waits 500 ms under the lock. A crash can shorten one dispatch gap in this
one-box trial. There is no automatic provider retry or stored reply to replay. Unlike recorded
control mutations, this exchange rejects a consumed call ID: its five-minute
call record outlasts the signature window without saving address content.

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

For the local fake-provider proof, run through a Docker-enabled test environment:

```sh
node scripts/test-postgres.mjs exec node --test packages/account-http/test/address-lookup.test.ts
```

The fake provider proves the wire and the limits. It does not measure Google's
address quality or complete Waitron’s screen integration. Before the owner tries
Google, configure the existing allowance for this account only and receive the
owner’s usage/quotas confirmation through the watcher. Removing the server’s key
file stops the trial. Public-service terms/privacy work and production enablement
remain separate.
