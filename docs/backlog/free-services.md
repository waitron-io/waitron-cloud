# Free services for open-source Waitron

Provide address lookup and transactional email delivery to open-source Waitron users
with a Cloud login, without requiring a paid subscription. Keep setup self-service.
These services should make ordinary account and address tasks easier even when a
venue does not subscribe to remote access or backups.

- **Address lookup.** Offer free geographic address lookup and completion to help
  fill out addresses correctly. The [2026-09-30 scope note](../address-lookup-scope.md)
  compares provider terms, cost scenarios, Waitron field mapping and account metering.
  Its Spain measurements select no provider: Google selects 22/28 supported cases, Geoapify
  autocomplete 17/28 and CartoCiudad 3/28, none reaching the proposed 95% gate; in the larger
  60-address comparison complete drafts occur in a five-result list for Google 48/60, Geoapify
  autocomplete 36/60, geocoding 40/60 (47/60 under the rural-municipality alternative) and
  CartoCiudad 0/60. The October comparisons used 363 Google, 320 Geoapify and 161 CartoCiudad requests, below
  1,499 each. The [terms check](../address-lookup-scope.md#google-can-propose-an-address-you-must-confirm-what-you-keep)
  identifies Address Validation's conditional confirmation route for merchant fields; Places
  selection alone does not establish durable storage permission. The owner chose
  Google. The [joint address plan](https://github.com/clintongormley/waitron/blob/main/docs/superpowers/plans/2026-11-24-address-lookup-finish.md)
  uses **Save** to confirm editable fields. The [Mac trial](../address-lookup-trial.md)
  measured first-choice drafts for 40 addresses. The signed test service allows parallel searches
  under per-owner, per-venue and shared limits. Each search counts even when you keep the
  manually entered address. Test operators can stop a venue in the account database, and the LAN
  action demo captures cap warnings. A stop button on the venue's operator page, billing-category
  and project quota readback, production limits, configured operator delivery,
  published privacy wording and the four Waitron forms on a connected box remain open.
- **Transactional email.** The [test relay](../transactional-email-relay-contract.md)
  covers staff invitations, password resets and email-change codes, plus old-address
  warnings, security changes, role changes, box alerts and certificate reminders.
  The latter two need the Waitron sender and a joint inbox check. See the
  [free email scope](venue-email.md#what-the-owner-decided-2026-11-21) for which
  notices still need your own mail server. The owner chose “Tick box, as proposed” for
  setup email (21 November 2026); its line names only what is sent, so adding guest mail
  needs a new consent version. The relay uses installation/account
  grants, fixed templates, encrypted admission,
  retry versus uncertain acceptance, abuse limits, metering and customer status.
  The grant, admission, worker and operator-stop core is built for explicit local use and
  normal startup leaves it off ([stop command](../transactional-email-relay-contract.md#stop-and-resume-the-local-relay),
  [admission bounds](../transactional-email-relay-contract.md#exercise-shared-admission-bounds)).
  Open before enablement: production domain/HTTPS origin verification, retention policy,
  authenticated provider suppression events, provider spending controls, production budgets and
  recipient-key custody, policy replacement (the immutable local policy refuses mismatched limits
  rather than resetting budgets) and admission-lock contention, which status, cancellation and
  retries share.
  Separately queue Waitron's durable caller/status work before a joint
  local proof.
  Decide provider, processing location, account consent, allowance/debit policy and
  password-reset-limit behaviour before production. The source trace also found
  Waitron's profile-email catch logs raw exception text (`apps/server/src/me-api.ts`
  at `0fbcde001`); actual secret exposure is unverified. The Waitron caller item must
  use bounded diagnostics and test secret-bearing exceptions before integration.
- **SMS codes (candidate).** The [SMS gateway design](../superpowers/specs/2026-11-07-cloud-venue-sms-gateway-design.md)
  holds the owner-approved provider, venue-counted monthly figures and daily cap,
  and initial monthly enforcement exception (owner, 2026-11-09). Sender/privacy/delivery
  qualification and implementation remain open;
  booking messages are outside this revision. Push notifications need a separate decision.
- **Per-user allowances.** Meter services against the Cloud user account, except SMS which counts
  per venue; enforce limits and show usage and remaining allowance. Define the allowance sizes, reset
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
