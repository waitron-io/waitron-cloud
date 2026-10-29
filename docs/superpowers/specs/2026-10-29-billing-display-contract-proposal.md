# Proposed shared section: Venue billing display, version 1

Status: D474 proposal, 29 October 2026. This is material for Waitron Lane B's
A1185 agreement, not an accepted contract or a running endpoint. Publish the
agreed section in Cloud's `docs/waitron-integration-contract.md` after the
separate [Slice J plan](../plans/2026-10-29-cloud-billing.md#slice-j-the-boxs-billing-view)
PR and fresh-context review. Record the agreed text's
SHA-256, both source revisions and Lane B's response before contract landing
or either adapter's build. No acceptance is claimed here.

## Purpose and authority

Your Cloud services screen shows billing; it never grants or withdraws local
services, trading, restore, promotion or fiscal authority. Choosing a level,
paying, cancelling and starting hosting remain on your Cloud account. A billing
read changes no billing, installation, service or worker state. HTTP rate-limit
accounting is the only expected write. Nothing here enables production billing,
collection, hosting or new enforcement.

POST `/api/installations/billing-display` with `Content-Type: application/json`
and outer object `{payload,signature}`. Use the existing Ed25519
`waitron-cloud-machine-v1` envelope with action `billing-display`, a fresh
operation UUID, the stored installation key, trusted exact country portal
origin and current control lease. The signed body is exactly `{"version":1}`.
There are no organisation, business, venue, country, URL or clock selectors.
Reject added selectors, including query parameters. An account cookie alone
has no authority here; any browser Origin header is refused.

Keep the existing 60-second proof window, one-hour maximum lease, 12,000-character
encoded payload limit, 86-character signature and 4,096-code-unit lease/body
limits. Preliminary stored-key authentication precedes the installation rate
budget. Reverify the signature and lease after locks, against the current key,
installation, venue and environment; reject revoked/superseded installations.
Resolve organisation and legal business through that installation's stored
venue, in the configured country's pool. Never take scope from parsed claims
other than using installationId to find the key to verify. A concurrent
revocation either waits for this read or commits first and prevents it.

This read is available independent of the venue's paid level and D79 test plan.
Do not require an active placement or ready service, which would hide a lapsed
venue's bill. It grants no placement or service capability.

## Response

Return HTTP 200 with a JSON object having these exact fields. Type declarations
describe the wire, not an implementation. `CivilDate` is a real `YYYY-MM-DD` day;
`UtcInstant` is canonical ISO UTC with milliseconds.

```ts
type Level = 'registered' | 'connected' | 'hosted';
type Period = {kind:'trial'|'paid'; level:'connected'|'hosted';
  from:CivilDate; until:CivilDate; coversAsOf:boolean};
type Billing = {status:'ready'; level:Level;
  state:'trial'|'active'|'payment_failing'|'lapsed'; period:Period|null}
  | {status:'unavailable'; reason:'state_not_ready'};
type Prices = {status:'published'; revision:number; effectiveFrom:CivilDate;
  currency:'EUR'; taxExclusive:true; vatRateBasisPoints:number;
  registeredMonthlyCents:0; connectedMonthlyCents:number;
  hostedMonthlyCents:number; hostedDayDivisor:30}
  | {status:'unavailable'; reason:'not_published'};
type BillingDisplayV1 = {version:1; installationId:string; venueId:string;
  countryCode:'ES'; calendarTimeZone:string; asOf:UtcInstant;
  billing:Billing; prices:Prices; accountUrl:string};
```

The two UUIDs bind the response to the saved registration. Do not send account,
organisation, business, charge, attempt, payment-method, mandate or provider IDs,
tax details, invoices, raw observations, keys or customer content. Validate the
binding before displaying anything. `version` is the independent billing wire
version. `revision` inside prices is only the published price revision, not an
installation revision or ordering token for the whole response. Unsupported
versions fail; incompatible field/meaning changes require a new version and
agreement. Version 1 is closed: both sides reject malformed/extra fields.

### Billing and periods

Apply these proposed rules in order, using one transaction's country facts:

1. A known owned venue with no billing business/venue rows is `registered`,
   `active`, `period:null`. Do not call `ensure_business` or start a trial.
   Missing identity/schema/database is an error, never this default.
2. An effective stored `lapsedOn` gives `lapsed`. Otherwise a stored active trial
   matching the current paid level and containing today gives `trial` and its
   exact interval. An expired still-active trial, future effective lapse, or
   inconsistent trial/level facts give `state_not_ready`; J does not run G's
   transitions or extend trials. A completed old trial does not hide paid state.
3. A venue charge is relevant only through its own `connected_month` line or
   exact hosted rows whose `consumed_by_charge_id` names that charge. A business
   total or another venue's line supplies no evidence for this venue. Include
   allocations with an omitted zero-cent hosted line.
4. A charge is currently settled when **any** attempt has accepted state
   `succeeded` and non-null first success. A pending attempt alone is neither
   success nor failure. With no remaining success, accepted `failed` or
   `refunded` is a failure signal, including while a retry is pending. Ignore
   history-only observations when deciding state. A later successful attempt
   on the same charge restores its coverage even if the first was refunded.
5. Outside trial/lapse, an unresolved failure gives `payment_failing` and
   otherwise the stored level gives `active`. `active` describes the stored
   billing level; it promises neither payment nor service readiness. Pending
   first payment, free joining days and hosted days billed in arrears may have
   `period:null`. Do not calculate a stop date or debt amount.
6. If an unresolved relevant failed/refunded charge with no remaining accepted
   success coexists with a currently settled **different** charge whose
   `renewalDate` is the same or later, return `state_not_ready`. Earlier unrelated
   successes alone do not meet this predicate. This conservative result asserts
   neither recovery nor debt: C has no reconciliation link that could establish
   settlement of the older failure. Do not infer it from UUID ordering, raw
   observations, a new anchor or a comeback charge.

For `trial`, use `[startedOn,endsOn)`. Otherwise derive paid coverage from
currently settled charges: a venue's connected line covers
`[renewalDate,connectedUntil)`; hosted coverage consists only of its exact
allocated civil days, each `[day,day+1)`. Never use hosted paid-history min/max
or a charge's hosted window as continuous coverage. Never turn connected
coverage into hosted coverage. Retained refunded history records past payment
for trial eligibility; it is not present paid coverage. `covered_by_charge_id`
records a historical connected discount, not settlement of the hosted charge.

Select coverage at the current paid level, or the most recent trial/paid level
for a registered lapsed venue. Coalesce only overlapping/adjacent paid intervals
at that same level. Select the interval containing today, else the last ending
on/before today, else null; never choose a future prepaid interval early.
For registered lapse, prefer latest `until`, then hosted on a same-end tie.
Use a completed trial only if no such paid interval exists. `coversAsOf` states
whether today belongs to the selected interval, so a historical end is not
mistaken for a paid-through promise. Null means no established period to show,
not an unlimited period. Never bridge an unpaid hosted day. This is a bounded
summary, not a history export.

`until` is the **first excluded day**, not a timestamp or last included day.
A trial starting `2026-10-31` ends at `2026-11-30`, so its last included day is
29 November. Use the configured billing calendar, never the browser's zone.
Require an explicitly configured IANA time zone. `Europe/Madrid` is a synthetic
fixture value, not a chosen production calendar. Production composition must
supply its agreed calendar before enabling the adapter. Quiet-hour hosting stops
are separate and cannot be inferred from this date.

### Published prices and destination

Select the greatest published revision effective on/before today's country
calendar day. Return its stored cents and VAT, never working estimates,
future prices, or a historic charge's frozen price. When no effective version
exists, return `prices:{status:'unavailable',reason:'not_published'}` while
retaining available billing facts. This does not mean zero or free. Do not seed
production prices. All numeric money fields are nonnegative safe whole EUR
cents. Registered is free; connected is per venue/month; hostedMonthlyCents is
the per-venue 30-day rate basis, charged by actual hosted days, not a promise
of a fixed calendar-month hosting charge. A hosted day's basis is monthly/30;
do not round a daily display figure and multiply it to quote a bill.

Prices exclude VAT. `2100` basis points means 21% in a synthetic fixture, not
a configured production tax decision. VAT is added once to the whole charge's
net total, rounded half up to cents. The hosted amount credits days already
covered by connected at the frozen charge's connected rate, divides the
aggregate numerator by 30, rounds half up and floors at zero (Slice B).
These price fields are a published list, not an invoice or individual quote.

`accountUrl` is exactly the configured trusted country portal origin plus
`/account`. Require HTTPS, no userinfo/query/fragment or caller destination;
only existing explicit loopback development-origin exceptions may use HTTP.
There are no tokens, return URLs or business selectors. Following it requires
the owner's ordinary Cloud login and ownership checks. The existing account
page is reachable; billing controls/invoices await F/H. A1185 should label
this “Open Cloud account”, without promising controls already exist. For an
unconnected venue, use the independently configured trusted Cloud origin's
existing signup journey; this authenticated endpoint cannot describe one.

## Errors, bounds and freshness

Errors contain only `{error:code}` and existing security headers. Retain the
app's 120/IP/minute general budget plus 60/IP/minute machine and
30/authenticated-installation/minute shared budgets across workers.

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `invalid_input` | Outer JSON/fields or query parameters invalid. |
| 400 | `invalid_request` / `unsupported_billing_version` | Signed body differs from the exact v1 body / sole canonical integer version is unsupported. |
| 401 | `invalid_proof` | Unknown installation, bad key/action/origin/time, lease or binding. |
| 403 | `forbidden` / `revoked` | Browser Origin/wrong host / revoked or superseded installation. |
| 405 | `method_not_allowed` | Anything except POST. |
| 408 / 413 / 415 | `invalid_input` | Request time / byte / media or encoding bound. |
| 429 | `rate_limited` | Shared budget exhausted; observe `Retry-After`. |
| 503 | `temporarily_unavailable` | Display adapter/issuer unconfigured, missing trusted country/calendar or unavailable database/schema. |

Read at most 16,384 request bytes within five seconds. Response JSON is at most
16,384 UTF-8 bytes. Waitron uses its configured exact HTTPS origin, refuses
redirects, and limits the complete response read to eight seconds/16,384 bytes.
All responses use `Cache-Control: no-store`; no ETag, 304 or server response
cache. A repeated read, including the same operation UUID, reauthenticates and
returns current facts. Do not persist a result in `installation_operations`.

Proposal: fetch on screen open/explicit refresh and at most once per minute
while visible, never in a sale path. Fence overlapping responses by saved
registration and request generation; ignore a slower older response. Persist
no billing snapshot. On an error, partial unavailability, disconnect or
revocation, show the affected section unavailable and clear its old values;
retain independent connection/service health. Do not turn an error into
`registered`, `lapsed`, zero prices or an entitlement decision. Retry 429 only
after its hint and do not renew a lease just because prices are unpublished.

## Decisions required before acceptance

Lane B must agree the action/body, complete schema, errors/bounds, independent
availability, historical/null-period rendering, refresh policy and URL rules.
Mandatory configured calendar, `active` as stored level with no paid interval,
and `state_not_ready` for the exact unresolved-history predicate above are
conservative engineering defaults under design §5, open to owner correction.
They grant no payment, recovery or stop promise. A definite failure/recovery or
stop date would require G's durable fact first; do not add an improvised migration
or accounting rule in J.
Production price sizes, retention, collection, hosted-stop legality and
provider/invoice qualification remain their existing gates.
