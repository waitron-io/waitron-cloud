# Test-box address lookup, first keyless piece

Build inline with `superpowers:executing-plans` after Claude reads this plan.

You need address suggestions on the owner’s paired test box. Prepare the Google
client first; add the single signed route after its accounting boundary is agreed.
No new table, job, grant or portal screen.

## Authority

The owner’s 6 November 19:29 step 5 in
`~/waitron-campaign-shared/a951-simple-brief-20261106.md` says:
“Add one Cloud route over Google” and “Keep manual entry, Google's attribution,
no stored provider responses and the request limits in `docs/address-lookup-scope.md`.”
The watcher’s `~/waitron-campaign-d/questions.md`, 7 November 00:31, says:
“Write step 5's short plan now and get its Claude read, then build the parts that
need no key, with address completion first.” Its 6 November 23:25 instruction says
“the unconditional production refusal stays, plus existing consent, cap and paging.”
The 23:25 quote concerns translation only. These notes authorise keyless preparation.
This supersedes the proposed October registration-adapter/multi-route layout only.

## Build now

- [ ] First write failing behavioural tests in
  `packages/account-http/test/address-lookup-google.test.ts`, observe their expected
  failures, then implement `src/address-lookup-google.ts` in that package.
  Export only from this module, never the package index. Require injected fetch
  with no default. Expose a Google client with `suggest({query,language,sessionToken}, signal?)`
  and `validate({selectedText,sessionToken}, signal?)`; inject fetch and a synthetic
  key for tests. No route, CLI, real key or default network wiring in this piece.
- [ ] Use Google Autocomplete (New) restricted to ES, and Address Validation with
  `regionCode: ES`, the same session token and only the selected address text.
  Return up to five suggestion texts or an editable draft containing
  `addressLine1`, nullable `addressLine2`, `postalCode`, `city`, `province` and
  `countryCode`. Return `provider: "google"` for E’s attribution display; discard raw replies,
  coordinates, place IDs and confidence flags. Use returned `route` plus `street_number` for line 1, `subpremise` for line 2,
  `postalAddress.postalCode`/`locality` for postcode/city and
  `administrative_area_level_2` for province. Missing fields are empty strings
  except null line 2. Require returned postal country ES; missing or foreign
  country refuses the draft. Country-component contradictions also refuse. E owns country-pack validation,
  attribution display and separate whole-address confirmation before saving.
- [ ] Bound input to 512 UTF-8 bytes (validation also respects Google’s 280-character
  total, counting Unicode code points plus the two ES characters), replies to 64 KiB and the entire request to five seconds. Fixed HTTPS
  endpoints, key only in `X-Goog-Api-Key`, language es/en, nonempty URL-safe token
  ≤36 characters. No redirects or automatic retries. Test complete/partial/empty and
  malformed replies, foreign countries, cancellation, stalled/oversized bodies
  and exceptions containing secrets. Errors are `invalid_input` before fetch, then
  `timeout`, `cancelled`, `rate_limited`, `refused`, `unavailable` or `malformed`.
  Errors expose `dispatched`; cancellation after fetch starts is uncertain.
  Log/store nothing. Start with a stub to reach an assertion failure, not an import error.
- [ ] Run `node --test packages/account-http/test/address-lookup-google.test.ts`
  red then green, and `pnpm exec tsc -p tsconfig.json`. Update
  `docs/backlog/free-services.md` and its summary in `docs/backlog.md` honestly.
  Prove critical guards by temporary omission, without permanent mutation tests.

## Before the route or real trial

- [x] Send the watcher the concrete proposal and review triage: one existing address
allowance hold/workflow, abandoned holds kept counted during this trial, existing
counters enforcing every scope ceiling, or full cancellation accounting instead.
The question is in lane D’s notes at 7 November 00:45. Claude accepts building the
client alongside it; RUNNER requires the watcher’s answer before landing.

`packages/account-http/src/rate-limit.ts:20,35,44` has first-hit fixed windows ≤one
day and pruning. `packages/registration/src/billing-allowances.ts:96,127` shares
address units by account only at registered tier and releases translation holds only.
These are source observations; extending existing storage is not proved impossible.
No address envelopes, hashes or replies enter installation operation records.

A later Claude-read amendment defines `/api/installations/address-lookup` and E’s
provider handoff. It must enforce account authority, all scope limits, restart/replay
and known outside usage; retain billing-terms/storage-interpretation acceptance and
public terms/privacy links; deliberately change the deployment key drop and add
new-path refusal checks. No gate is waived. No Waitron edits. Translation is separate.
