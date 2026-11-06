# Test-box address lookup, first keyless piece

Build inline with `superpowers:executing-plans` after Claude reads this plan.

You need address suggestions on the owner’s paired test box. Prepare the Google
client first; add the single signed route after its accounting boundary is agreed.
Use existing Node, TypeScript and Hono. No new table, job, grant or portal screen.

## Authority

The owner’s 6 November 19:29 step 5 in
`~/waitron-campaign-shared/a951-simple-brief-20261106.md` says:
“Add one Cloud route over Google” and “Keep manual entry, Google's attribution,
no stored provider responses and the request limits in `docs/address-lookup-scope.md`.”
The watcher’s `~/waitron-campaign-d/questions.md`, 7 November 00:31, says:
“Write step 5's short plan now and get its Claude read, then build the parts that
need no key, with address completion first.” Its 6 November 23:25 instruction says
“the unconditional production refusal stays, plus existing consent, cap and paging.”
These notes authorise preparation, not provider calls, spending or production.

## Build now

- [ ] First write failing behavioural tests in
  `packages/account-http/test/address-lookup-google.test.ts`, observe their expected
  failures, then implement `src/address-lookup-google.ts` in that package.
  Export a Google client with `suggest({query,language,sessionToken}, signal?)`
  and `validate({selectedText,sessionToken}, signal?)`; inject fetch and a synthetic
  key for tests. No route, CLI, real key or default network wiring in this piece.
- [ ] Use Google Autocomplete (New) restricted to ES, and Address Validation with
  `regionCode: ES`, the same session token and only the selected address text.
  Return up to five suggestion texts or an editable draft containing
  `addressLine1`, nullable `addressLine2`, `postalCode`, `city`, `province` and
  `countryCode`. Return Google attribution requirements; discard raw replies,
  coordinates, place IDs and confidence flags. Missing fields stay missing;
  foreign-country evidence refuses the draft. E owns country-pack validation,
  attribution display and separate whole-address confirmation before saving.
- [ ] Bound input to 512 UTF-8 bytes (validation also respects Google’s 280-character
  total), replies to 64 KiB and the entire request to five seconds. Fixed HTTPS
  endpoints, no redirects or automatic retries. Test complete/partial/empty and
  malformed replies, foreign countries, cancellation, stalled/oversized bodies
  and exceptions containing secrets. Return fixed error labels; log/store nothing.
- [ ] Run `node --test packages/account-http/test/address-lookup-google.test.ts`
  red then green, and `pnpm exec tsc -p tsconfig.json`. Update
  `docs/backlog/free-services.md` and its summary in `docs/backlog.md` honestly.
  Prove critical guards by temporary omission, without permanent mutation tests.

## Before the signed route or real trial

`docs/address-lookup-scope.md` and its linked 16 October proposed design require
account, workflow and provider limits, durable reservations and known shared usage.
Current `src/rate-limit.ts:20,35,44` supports rolling windows up to one day and prunes
expired rows. Registration’s `billing-allowances.ts:96,127` shares address usage by
account only at the registered tier and releases holds only for translation.
These are source observations, not proof that existing tables cannot be extended.
Do not widen those meanings or put address data in installation operation records.

Ask the watcher for the smallest approved use of existing counter storage for this
one-box trial before implementing route admission. Keep provider calls disabled
until exact limits, account authority, restart/replay behaviour and outside usage
are covered. Proposed route is `/api/installations/address-lookup` over the existing
signed envelope; its final body/reply and E’s provider handoff follow that decision
and a Claude-read amendment. No Waitron edits. Translation is a separate later piece.
