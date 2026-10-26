# Free services for open-source Waitron

Provide address lookup and transactional email delivery to open-source Waitron users
with a Cloud login, without requiring a paid subscription. Keep setup self-service.
These services should make ordinary account and address tasks easier even when a
venue does not subscribe to remote access or backups.

- **Address lookup.** Offer free geographic address lookup and completion to help
  fill out addresses correctly. The [2026-09-30 scope note](../address-lookup-scope.md)
  compares provider terms, cost scenarios, Waitron field mapping and account metering.
  Its 2026-10-16 Spain measurement fixes 40 public/synthetic cases before testing:
  Google selects 22/28 supported cases, Geoapify autocomplete 17/28 and CartoCiudad
  3/28 under a conservative first-result mapping. None reaches the proposed 95%
  gate. The item counters are 78 Google, 80 Geoapify and 41 CartoCiudad attempts,
  including one conservative documentation probe; no retries or customer data.
  The harness, corpus, per-case scores and component/latency tables are retained;
  raw provider responses are local-only and deleted at landing. The later
  [terms check](../address-lookup-scope.md#google-can-propose-an-address-you-must-confirm-what-you-keep)
  identifies Address Validation's conditional confirmation route for merchant
  fields; Places selection alone does not establish durable storage permission.
  The owner approved a larger residential/rural comparison. Its fixed
  60-address regional corpus compares unchanged and postcode-free queries, supplied
  versus postcode-derived provinces, and the first result versus presence in a
  bounded list. It retains the original request counters and manual-entry rule;
  its 120-query results retain the original reference fields and a separate rural
  municipality sensitivity check. With postcodes, complete drafts occur in a
  five-result list for Google 48/60, Geoapify autocomplete 36/60, geocoding 40/60 and
  CartoCiudad 0/60; the rural municipality alternative raises Geoapify geocoding to
  47/60 without new requests. Postcode omission gives CartoCiudad one complete draft.
  These regional, field-mapping results do not select a provider or prove setup
  integration. Cumulative attempts remain Google 363, Geoapify 320 and CartoCiudad 161,
  below 1,499 each, with no errors or retries in the second run. The owner's next
  preference is Google with Geoapify fallback. Its
  [proposed design](../superpowers/specs/2026-10-16-address-suggestions.md) and
  [plan](../superpowers/plans/2026-10-16-address-suggestions.md) specify explicit whole-address
  confirmation, provider-specific attribution, no shared response cache, ten
  confirmed selections per account per month and a zero-paid-usage budget. These
  are proposed defaults, not approved production allowances or configured key caps.
  Effective billing terms, accounted shared usage, operator quotas, Geoapify Free
  eligibility/storage rights, locality policy and joint Waitron setup acceptance
  remain release gates. The retained CartoCiudad audit agrees with published
  scores and the earlier parser fix; a new raw-response re-score is unavailable
  because both landings deleted those replies. No further provider call or
  product route/UI is added.
  The offline evaluation client now waits a full spacing interval when created,
  including after reopening its durable journal. A controlled 150 ms reservation
  delay reproduces a restart dispatch less than the original 90 ms test bound;
  the new guard passes that bound without changing allowance, retry or deadline
  checks. CI run 38950506223 failed the original restart-spacing assertion, but
  retained no write/dispatch stages, so its exact trigger remains unproved.
  No provider request is needed for this fix. The sequential evaluator now converts
  its initial journal delay to elapsed time, so later wall-clock changes neither
  bypass nor extend request spacing. Long waits use bounded timer chunks and
  recheck the deadline before reserving another request. Real-child offline checks
  cover a journal thirty days ahead, a smaller future timestamp that eventually
  permits dispatch, and forward/backward clock changes. A simulated long wait
  checks completion after the entire delay. Existing request/attempt budgets,
  restart spacing and durable reservations remain covered. Overlapping calls are
  still unqualified; keep this measurement client sequential. These checks permit
  no new provider requests. Before a spacing wait of at least one minute, the
  evaluator and regional comparison print one stderr notice with rounded-up
  remaining seconds and guidance to check future journal timestamps. Ordinary
  waits stay quiet; the notice does not shorten the wait or spend a request.
  Offline child checks cover a paused wait and completion across timer chunks.
  Keep manual entry and correction available when lookup is unavailable or wrong.
- **Transactional email.** Offer managed SMTP delivery for password resets and other
  account administration emails from on-prem Waitron. Scope the relay to these
  messages, authenticate requests and handle delivery failures and abuse. The existing
  Cloud email transport is a starting point. The [version 1 relay contract](../transactional-email-relay-contract.md)
  now scopes installation/account grants, fixed templates, encrypted admission,
  retry versus uncertain acceptance, abuse limits, metering and customer status.
  The disabled local-proof grant and account reservation core is implemented, with
  PostgreSQL concurrency, revocation, rollover and process-restart tests. The trusted
  origin-verifier boundary has synthetic evidence tests only; implement and prove
  production domain/HTTPS verification before enablement. Signed submit/status/cancel
  and an encrypted queue now have opt-in local HTTP/PostgreSQL proof for retries,
  concurrent account reservations, key rotation/loss, cancellation and transaction
  rollback, including admission racing installation revocation/replacement. Normal
  startup keeps the routes absent. The separate local relay worker now handles
  bounded claims, expiry, keyed suppression and terminal ciphertext removal, with
  state/reason constraints. Its loopback-only SMTP proof covers temporary/permanent
  refusal, two-worker fencing, cancellation, key rotation/loss and uncertain delivery
  after disconnect or process death. Normal startup leaves it off. Retention policy,
  authenticated provider suppression events and provider spending controls remain
  open. Shared keyed recipient and stable-grant counters now enforce explicitly
  configured local budgets across independent HTTP processes. Migration 034 accounts
  for actual retained encrypted payload bytes, including sending and delayed work;
  clearing payload releases bytes without refunding message counts. Exact retries
  spend nothing extra. Local PostgreSQL proofs cover races, rollback, key rotation,
  deadline expiry during lock waits, worker cleanup and populated upgrades, including
  interrupted migration and separate pre-upgrade backup restore with external keys.
  See the [admission-bounds design](../superpowers/specs/2026-10-12-relay-admission-bounds-design.md)
  and [local acceptance commands](../transactional-email-relay-contract.md#exercise-shared-admission-bounds).
  Choose production budgets and recipient-key custody before enablement; normal
  startup still has no relay configuration. The immutable local policy deliberately
  refuses mismatched limits rather than resetting budgets. Policy replacement remains separate work. The
  [reviewed operator-stop design](../superpowers/specs/2026-10-13-relay-operator-stop-design.md)
  and [implementation plan](../superpowers/plans/2026-10-13-relay-operator-stop.md)
  cover durable local control. The stored flag and transaction API now pass
  focused PostgreSQL checks for committed stop/resume, missing-state refusal and
  shared-reader ordering. Migration 036 preserves populated release-35 account,
  factor and relay state through concurrent/repeated upgrade and interrupted
  rollback/retry. The trusted local stop/resume/status command validates every
  migration name and digest, returns one JSON line after commit and bounds database
  waits. Its subprocess/PostgreSQL checks cover failed commits, cancellation,
  preserved queue state and silent root/package forwarding. Two running HTTP
  processes now refuse new message IDs while stopped without relay spend, then
  admit after resume without restarting. Exact retries, status and cancellation
  retain current authority and byte accounting. Admission and stop races keep the
  shared control lock through commit or rollback, including a reader proceeding
  while stop waits. Two persistent local workers now pause claims and handoff
  independently, resume without restarting and retain paused queue rows and spend.
  A stopped handoff releases only its own queued claim. Messages already committed
  as sending retain their real SMTP result, even if the connection starts after
  stop succeeds. Stopped recovery still clears expired sending as uncertain and
  fences late replies; Cloud verification, password reset and venue alerts still
  deliver. The focused worker/account-mail command passes 125 checks, including
  observed lock waits, process restart, cancellation and held SMTP replies; 19
  deliberate breakages fail inspected assertions in a separate checkout.
  The explicit 35-to-36 rehearsal now passes all 28 version-3 checks: interrupted
  migration rolls back, every populated old row and complete ledger survives,
  stop persists across restart, and a separate stopped backup restores stopped.
  Matching external keys permit status, cancellation and exact retries; wrong or
  missing keys refuse, and resume delivers only to local Mailpit. A separately
  restored pre-stop backup initializes not-stopped after upgrade; the stopped source
  stays unchanged. Fifteen receipt/parser and eight real database/key breakages fail
  their assertions; restored proof passes with zero owned resources remaining.
  Packaged local install, restart and rebuilt upgrade also pass with 36 migrations
  and zero leftover resources.
  See the [trusted stop command](../transactional-email-relay-contract.md#stop-and-resume-the-local-relay)
  and [version-3 rehearsal](../database-recovery.md#rehearse-the-relay-stop-upgrade).
  Run `node scripts/test-postgres.mjs exec pnpm --dir packages/account-http exec
  node --test --test-timeout=120000 test/relay-operator-stop.test.ts
  test/relay-messages.test.ts test/relay-admission-bounds.test.ts
  test/relay-disabled.test.ts` for the local admission checks.
  Run `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec
  node --test test/relay-control.test.ts test/relay-control-migration.test.ts
  test/relay-control-cli.test.ts`. Measure admission-lock contention
  before production enablement: status, cancellation and retries share that lock.
  Separately queue Waitron's durable caller/status work before a joint
  local proof.
  Decide provider, processing location, account consent, allowance/debit policy and
  password-reset-limit behaviour before production. The source trace also found
  Waitron's profile-email catch logs raw exception text (`apps/server/src/me-api.ts`
  at `0fbcde001`); actual secret exposure is unverified. The Waitron caller item must
  use bounded diagnostics and test secret-bearing exceptions before integration.
- **Mobile notifications (candidate).** Consider a free allowance for mobile phone
  notifications. Choose the delivery channel and validate its costs before committing
  to inclusion; push notifications and SMS need separate cost estimates.
- **Per-user allowances.** Meter each service against the Cloud user account, enforce
  limits and show usage and remaining allowance. Define the allowance sizes, reset
  periods and behaviour at the limit, including password-reset delivery. Settle how
  venue-generated requests count against an account and prevent multiple installations
  from bypassing its allowance. The relay contract proposes one unit per admitted
  message. Shared account reservations now exist behind explicit local-only policy
  configuration; no production allowance is approved. Policy-version changes require
  a separately specified account upgrade path. Keep provider credentials in Cloud.

Low operating cost is an assumption to validate against provider pricing and expected
usage. Estimate costs and abuse exposure before setting allowances, and apply the
existing Spain-first residency preference when selecting providers. Next: resolve the
[address lookup scope note's](../address-lookup-scope.md) storage, quality, cost and
account-allowance gates, then the authenticated email relay; evaluate mobile
notifications separately.
