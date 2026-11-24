# Cloud billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Cloud billing as the approved design describes, one slice at a time. This
plan gives the order of every slice and the full tasks for slice B (the billing rules),
which can start now.

**Architecture:** Billing's date and money rules are pure functions in
`packages/registration` (slice B). Storage, providers, workers and pages are built on them
in later slices, each planned in full when its turn comes, as the production deployment
plan does.

**Tech Stack:** TypeScript run directly by Node 26 (type stripping), `node:test` with
`node:assert/strict`, PostgreSQL migrations in `packages/registration/migrations`.

**Spec:** [docs/superpowers/specs/2026-10-29-cloud-billing-design.md](../specs/2026-10-29-cloud-billing-design.md)

## Global Constraints

- Nothing billing does touches local trading on a box; the box shows billing values and
  never acts on them (spec §1, §5).
- Levels: `registered` (level 1, per account), `connected` (level 2, per venue), `hosted`
  (level 3, per venue) (spec §2).
- A hosted day costs one thirtieth of the level-3 monthly price; a day already paid at
  level 2 counts towards it (spec §2).
- Trial: 30 days, once per venue per level, no payment details needed; reminders a week
  before the end and on the last day; tighter translation and rota-solver allowances only
  while no payment method is on file (spec §4).
- A connected trial not really used is extended by a month, once. "Really used" means
  remote-access traffic on at least three different days, or one translation run, or one
  rota-solver run. A hosted trial is never extended (spec §4).
- A business's renewal date is the day it first started paying. A renewal day of the 29th
  to the 31st falls on the last day of a shorter month (spec §6).
- A later venue joins the business's renewal date; the days before it are free (spec §6).
- Cards are first tried 7 days before the renewal date; direct debit 10 days before
  (spec §6).
- Level 2: online services stop on the renewal date after a failed payment. Hosted: about a
  month of retries, weekly by card or 14 days apart by direct debit with none in the final
  10 days, then hosting stops. A pending debit prevents another attempt (spec §6).
- Coming back after a hosted lapse costs the unpaid hosted days; a lapsed level 2 owes
  nothing; the return day becomes the new renewal date (spec §6).
- Money is whole cents, as integers. Prices are before VAT; VAT is added once per charge on
  its total, at a rate from configuration (spec §9).
- A refunded direct debit counts as a failed payment from the day we learn of it, with the
  same countdown (spec §6). Slice B reads "the same countdown" as a renewal date 7 days
  after that day (driver's call).
- A venue on a trial is never on a charge attempted before its trial's outcome is decided
  (driver's call, from the plan review).
- Prices and allowance sizes are configuration, never constants in code (spec §11).
- Billing code goes in `packages/registration`, not a new package: CI pins every
  `package.json` by hash (`scripts/ci-install-inputs.mjs`), so a new package means CI
  work that slice B does not need (driver's call).
- Code, identifiers and tests in English; match the package's compact style; comments only
  for an invariant the code cannot show.

## Review Focus

1. **A renewal day of the 29th–31st in February, in leap and ordinary years** — the date
   falls on the 28th or 29th and returns to the anchor day in March. Pinned in Task B1.
2. **A charge whose renewal date is closer than the lead time** (a new business's first
   charge when its trial converts, or a comeback) — the first attempt is today, never a date
   in the past. Pinned in Task B1.
3. **A venue whose trial ends just before, or on, the business's renewal date** — it is
   left off that charge, because the charge was attempted before its trial's outcome was
   known; it is first charged on the next renewal whose attempt falls after its trial ends.
   The days between are free. Pinned in Task B1.
4. **A hosted venue paying by direct debit during its month of grace** — no retry is sent
   while an earlier debit may still be pending, and none that cannot confirm before hosting
   stops. Pinned in Task B1.
5. **An unused trial whose owner has already added a payment method** — it is still
   extended once before it converts; the owner said an unused trial is extended. Pinned in
   Task B2.

---

## The slices, in order

Each slice after B gets its own plan, written when its turn comes. A slice's plan names
its tasks; this list names what it delivers and what it waits for.

| Slice | Delivers | Waits for |
| --- | --- | --- |
| **A. Provider test** | A receipt (`docs/billing-provider-test.md`) of four runs: in SumUp's sandbox, save a card, then charge it again with no customer present, and read the fee charged; in Stripe test mode, collect a SEPA mandate on Stripe's page, take a debit, and receive its success, failure and dispute webhooks. The scripts stay outside the repository; the receipt states each command and what it printed. If SumUp cannot charge a saved card without the customer, the receipt says so and slice F uses Stripe for cards. | The owner: a SumUp developer sandbox merchant account with an API key, and a Stripe account in test mode. |
| **B. Billing rules** | Pure date and money rules (tasks below). | Nothing. |
| **C. Billing store** | Tables for businesses' renewal days and payment methods, venues' levels, trials and payment history, charges and their lines, hosted-day records, and an idempotent billing event log; a store class over them. The price list and VAT rate as published configuration. All of it in the country's own database (spec §10). How long billing records are kept follows the lawyer's answer (spec §8, §12). | B; a free migration number (recheck reservations in `docs/backlog.md` first). |
| **D. Levels replace the test switch** | Per-venue levels drive the existing enforcement points D79 added; translation moves to level 2; D79's downgrade rules carry over. | C. |
| **E. Allowances and traffic** | Per-level monthly allowances as configuration; a remote-access traffic unit per venue per day in the usage ledger; trial tiers. | C. |
| **F. Payment methods and the account pages** | Portal pages to choose a level, give tax details, add or switch a card (SumUp) or direct debit (Stripe), cancel (saying the month already paid runs until its date), close the account, and start hosting from the account, the step that agrees the level-3 price. The supplier register rows and country flows both providers need before live data. | A, C. |
| **G. Trials, renewals and failures** | A worker that runs trials (reminders, extensions, the drop to level 1, joining the renewal date, stopping an unpaid hosted trial at the quiet hour) and renewals: it builds each charge from B's rules, attempts it, never sends a direct-debit retry while one is pending, sends the emails (including 30 days' notice of a price change), stops services, stops hosting at the venue's quiet hour, and handles a refunded direct debit and a comeback. It takes no live money before slice H can invoice it. | B, C, D, E, F; the data-protection exit lifecycle (download, 90 days readable, purge), which is not built yet; the lawyer's answer on stopping a hosted venue for non-payment, before the hosted stop is switched on. |
| **H. Invoices** | Cloud's own invoices through Waitron's Veri\*Factu library. | The Waitron company and its declaración responsable for this software (spec §9); the asesor's answer on direct-debit invoices (spec §12). |
| **I. Emergency hosting** | The owner's pre-agreement setting, the venue emergency code, and the code page that starts a locked copy. | C, F, G; Waitron A1188 and A1018; production plan P6. |
| **J. The box's view** | The billing section of the shared integration contract, served to the box for Waitron A1185. | C; Waitron's agreement on the contract. |

---

## Slice B: billing rules

Four files, each one responsibility, all pure (no database, no clock: the caller passes
`today`):

- `packages/registration/src/billing-calendar.ts` — calendar days, renewal dates, attempt
  dates, failure timelines.
- `packages/registration/src/billing-trials.ts` — trial ends, reminders, use, outcomes.
- `packages/registration/src/billing-charges.ts` — hosted-day amounts and the lines of one
  renewal's charge.
- `packages/registration/src/index.ts` — exports.

Tests are in `packages/registration/test/billing-*.test.ts`. They need no database. Run one
file from the worktree root with `node --test packages/registration/test/<file>`. A passing
run prints `ℹ fail 0` beside a non-zero `ℹ tests` count. A run that prints no `ℹ tests` line
proves nothing.

> **Built.** Slices B, C, D, E and J are on main; the decisions and boundaries of each stay below. Their step-by-step text was removed on 24 November 2026; read it with
> `git show 3c69f4903:docs/superpowers/plans/2026-10-29-cloud-billing.md`.

### Boundaries for later slices

Slice C supplies one charge view per venue, so a renewal cannot include the same venue
twice. Slice G calculates a first venue's attempt date only when its trial converts,
after any extension is decided; calculating it mid-trial could schedule a charge before
the outcome is known. Slice G also checks whether a debit is still pending before any
retry. Slice A must qualify provider confirmation timing; the 14-day interval alone does
not prove a debit has settled.

### After slice B

Update `docs/backlog.md` item 3 in the same pull request: slice B is built, and slice C's
plan is next. Then write slice C's plan.


## Slice C: billing store

You need durable billing facts before a worker can decide what to charge. This slice
adds country-local storage and internal store interfaces over B's rules. Execute the
five tasks inline as the driver, after this plan lands separately and receives its
fresh-context review (the D461 prerequisite under RUNNER §5.2). The existing plan
header does not require another implementation agent for C.

### Scope and execution gates

- Use the country's registration `Pool`, Spain (`ES`) initially, for every table and
  store below. No global database lookup or provider call belongs in these methods.
  The pool's country binding comes from the trusted country service, not request input.
- C stores facts. D replaces enforcement gates, E owns allowances/traffic, F owns
  provider validation and pages, G owns worker decisions, H owns invoices, I owns
  emergency consent/codes, and J owns the shared contract. C does not make billing live.
  Leave D79's mode, its callers and deployment defaults unchanged and enforcement off.
- Use existing `organisations`, `legal_businesses` and `venues` identities. Do not
  create a second customer registry. Adapters authenticate owners/machines before
  supplying scope, as `packages/registration/README.md` requires for internal stores.
- No fiscal records, registry code, fiscal migrations or historical SQL changes.
  Cloud owns this store under `docs/documentation-ownership.md`; C changes no Waitron
  contract. No venue content, card number, IBAN, mandate text, credential, provider
  response body or arbitrary metadata enters a billing row, receipt or error.
- Production prices remain unset. Test fixtures may publish `{connectedMonthlyCents:
  1000, hostedMonthlyCents:3000}` and `vatRateBasisPoints:2100`; these are configurable
  synthetic values, not a production price decision. Absent prices fail closed.
- Lawyer question 2 still owns retained fields, durations and access policy. Retain
  the rows for now: no cascading delete, cleanup integration or deletion job. Restrict
  deletion through foreign keys; later exit work must reconcile these references with
  the approved lifecycle rather than silently deleting billing history.
- Migration `045_billing_store.sql` is provisional. The local manifest and `main` at
  `1a3e43e885edfbe9932c835e3f4fb8929718b2dc` end at 044. Before building, recheck
  `docs/backlog.md`, migration reservations in the relevant checked-in plans, the SQL
  directory, manifest and the driver's current reservation record. If occupied, choose
  the next coordinated slot and update C's new filename/pair expectations together.
  Never read credentials or change campaign state to do this reconciliation.
- Docker is unavailable locally until 3 November. Do not run `scripts/test-postgres.mjs`
  locally during that period. Local native typechecking and pure `node --test` runs are
  allowed. Every database RED, GREEN, guard-omission proof and actual upgrade/recovery
  run below is **CI-only** while that restriction holds.
- For each task, commit only its tests first with `git commit -s`, push through the
  normal hooks to the implementation PR, and observe the named database failure in
  the registration package job before writing its implementation. Use dynamic URL
  imports/runtime export assertions in the initial tests where static imports of a
  missing module would make typechecking fail first. A missing table/export is a valid
  initial RED; setup failure, timeout, unavailable PostgreSQL or skipped tests is not.
  Add no production stubs to manufacture RED. If CI cannot execute the tests, stop
  implementation at this gate and report the missing evidence to the driver.
- Each later implementation commit needs its named GREEN on that exact new head.
  Earlier-head success does not qualify changed code. Keep reserved `.github/workflows/*`
  and `scripts/ci-*` files, package manifests and lockfiles unchanged. The existing
  `test/*.test.ts` discovery supplies database coverage; C5 supplies its proof wrapper.

### Review focus

1. A valid UUID from another business, including one in the same organisation, must
   neither read nor mutate that business's rows. C1/C2 test SQL and store boundaries.
2. Two first paying venues must settle on one business anchor; a stale comeback must
   not replace it. C2 uses two independently blocked PostgreSQL connections.
3. A retry after a lost reply must return the committed result; a reused key with
   changed data must refuse, including across provider/business bindings. C2 tests both.
4. A hosted day already charged, or only provisionally covered by an unpaid connected
   charge, must not receive a second charge or an unearned discount. C3/C4 test both.
5. A late pending/failed observation must not undo accepted success/refund, and a
   changed price must not rewrite a historical line. C4 tests state and frozen amounts.

### Coverage and unresolved decisions

Spec §2 maps to C3's venue state/hosted coverage and C4's B-compatible frozen lines;
§4 maps to C3/C4's independent trial and actually-paid history; §6 maps to C2's stable
anchor/method/event ownership and C4's charge/payment facts; §8 maps to retained rows
without cascading deletion; §10 maps to the trusted country pool and unchanged ownership
boundary. C5 supplies migration, consumer, recovery and omission receipts for that store.
All method/handler types above share C1 declarations; C3/C4 execute inside C2's transaction.

Production prices and allowances, lawyer retention fields/durations/access policy,
provider qualification and webhook acceptance policy, worker transitions/retry schedules,
invoice/refund treatment and the remaining D–J contracts stay with their named slices
or advisers. None blocks synthetic C storage tests; none is settled or enabled by C.

## Slice J: the box's billing view

Waitron A1185 needs billing facts it can show without making a sale depend on
Cloud. Add one authenticated country read, separate from service configuration.
The design is approved (§5). Lane B agreed the wire proposal on 29 October
2026 with five additions, now recorded in the [canonical contract](../../waitron-integration-contract.md#venue-billing-display-version-1).
The separate contract publication precedes J's implementation; no adapter is built.
Execute inline after the separate docs-only plan PR lands and its fresh-context
review is resolved (RUNNER §5.2). This section overrides the generic header's
recommended delegation for J. It does not authorise implementation in the plan
author's session.

### Scope and execution gates

- C is installed at inspected Cloud `3d3c3def00bf27d60f2d97f5c23cd4acc1aebf7d`.
  Read `billing-{types,config,store,venues,payments}.ts` again at build time.
  Reuse its country pool, ownership and accepted payment facts. No global lookup,
  provider call, trial start, billing write, worker transition or enforcement.
- First finish/review/land this plan as its own docs-only PR. The driver then
  proposes the exact contract draft
  to Waitron Lane B for A1185 and records the accepted text's
  digest, both source pins and agreement. Only then land that section in
  `docs/waitron-integration-contract.md` and begin J's code. This author writes
  neither campaign questions nor acceptance. Plan publication is not agreement.
- Prices and VAT come only from published country configuration; no defaults,
  production seeds or allowance sizes. J does not enable production collection,
  billing workers, hosting, fiscal operations or D79's replacement enforcement.
  No migration is expected: 045 already holds the required exact dates, lines
  and accepted states. Missing reconciliation facts use the explicit unavailable
  result; a demand to store new accounting meaning reopens design/coordination.
- Docker is down until 3 November. Run pure tests and types natively. For each
  database task, sign off and push its **test-only** commit through normal hooks;
  observe the intended named RED in actual registration/account-http CI before
  writing implementation. Use runtime imports/export assertions so missing new
  modules fail in the test, not at typecheck. A missing DB, setup error, timeout,
  skipped test or an unrelated red job is not behavioral RED. Require the named
  GREEN on the implementation SHA. If CI cannot run it, stop at that gate.
- Do not run Docker, `pnpm test` or `scripts/test-postgres.mjs` locally while that
  restriction holds. Commands marked **CI** below execute inside the existing
  package jobs' disposable PostgreSQL environment. Do not replace real DB tests
  with mocks, alter CI selection to escape checks or duplicate whole CI locally.
- Preserve all original assertions. Add tests in J-specific files rather than
  rewriting installed machine/configuration or paid-history tests. No edits to
  the fiscal registry, shipped SQL, migration manifest, package manifests,
  lockfiles, `.github/workflows/*` or `scripts/ci-*`.

### Proposed interface and review focus

Use POST `/api/installations/billing-display`, signed action `billing-display`,
exact signed body `{"version":1}` and the existing machine envelope/control
lease. No request IDs select organisation, business or venue. Derive all three
through the verified installation's current stored venue in the country pool.
Return a separate `BillingDisplayV1`; never add billing to `InstallationView`.

The proposed response has `version:1`, `installationId`, `venueId`,
`countryCode:'ES'`, `calendarTimeZone`, canonical UTC `asOf`, `billing`, `prices`
and `accountUrl`. `billing` is either `status:'unavailable',reason:'state_not_ready'`
or `status:'ready',level,state,period`, with the design's three levels/four states.
`period` is null or `{kind:'trial'|'paid',level:'connected'|'hosted',from,until,
coversAsOf}`. All interval ends are the first excluded country civil day.
`prices` is either unavailable/not_published or the effective published revision,
effective day, EUR, taxExclusive true, VAT basis points, free registered 0 cents,
both configured monthly-cent values and hostedDayDivisor 30. Exact rules and
refusals are in the proposal; copy its agreed edition into the shared contract.

1. An uninitialised owned store is registered/active with no period and no writes;
   missing identities/schema/DB must never become that default (J1/J2).
2. A refunded first success stays in trial-eligibility history. Current coverage
   requires any remaining accepted success on the same charge; raw observations
   and pending retries cannot manufacture it (J1/J2).
3. Another venue's paid line supplies no coverage. Hosted dates are exact allocated
   rows, including omitted zero-cent lines; min/max, windows and connected-credit
   references never fill holes or establish hosted payment (J1/J2).
4. Missing/future prices and unknown billing state are separate partial results.
   Free joining days/hosted arrears have no invented paid end, and a delayed G
   transition or ambiguous recovery is unavailable, not a guessed lapse (J1).
5. Revocation/replacement, queued reads, forged body IDs, stale/redirected responses
   and unsafe URLs cannot cross the installation/account boundary (J2/J3/J4).

### Facts checked, decisions and blocking ambiguity

Source inspection, not runtime qualification: C's `business()` needs a billing
business row but `venue()` can default an owned missing venue row;
`packages/registration/src/billing-venues.ts:27` retains refunded paid history;
`packages/registration/src/billing-payments.ts:80`
builds hosted history bounds from min/max; actual allocation rows remain exact.
`packages/registration/src/billing-config.ts:34` selects effective published prices
without defaults. Machine proof/runtime action lists are in
`packages/registration/src/installation-proof.ts:4` and `:41`;
`packages/registration/src/installations.ts:78` is only preliminary authentication.
The existing HTTP dispatcher at `packages/account-http/src/app.ts:150` requires
an earlier exact-path route.
Recheck line numbers after rebase; the named interfaces are the durable pointers.

Read-only Waitron inspection at
`6206c1a9f4f6e8b693fac5e11a2418fd249364ed` found the actual consumers in
`apps/server/src/{cloud-client,cloud-installation,cloud-api}.ts` and
`apps/dashboard/src/{api/client,screens/cloud-services-screen}.ts`. The server
uses saved registration/key/origin and manager `system.manage`; the dashboard
shows service state/health, not billing. A1185 remains the local implementation.
Its existing account/configuration path is not a billing decoder. No runtime
tests or joint client qualification were performed by the plan author.

Proposed engineering choices are a separate versioned read, independent price
availability, exact half-open coverage, no stored response cache, safe existing
account destination and unavailable results where the store cannot tell the
truth. Before contract/build, Lane B must agree those choices. Calendar is a
mandatory configured IANA time zone; `Europe/Madrid` is only a synthetic fixture,
not a production billing-calendar decision. `active` describes the stored level,
not established payment; a null period is explicit. When unresolved failed or
refunded charges coexist with a settled different charge of the same or later
renewal date, the display is unavailable rather than inferring settlement.
These are conservative engineering defaults under design §5, not new payment,
recovery or stop promises. Record them as coordination defaults, open to owner
correction. A definite recovery/stop promise would require G's durable fact first.
Production calendar, price sizes, legal retention and live provider/hosting
qualification stay with their release gates. They do not block synthetic J tests
once Lane B agrees the contract.

## Slice D: per-venue levels replace the test switch

You need two venues in one organisation to have different service permissions.
Use C's country-local facts, with one transactional permission reader and one
transition path. C landed in PR #718 at `3d3c3def`; this inspection is at
`b338275c3ba4e2b211d7617b03d38e95b916ee7c`. C's
`BillingStore.execute(scope,event,command)` and `applyVenueCommand(context,command)`
currently record levels/trials without changing installation setup. They are not
service transitions. The engineering choices below implement design §§2–4, 6,
8, 10 and 13; they need no additional owner decision.

### Boundaries and coordination before implementation

- Land this appendix as a docs-only PR after fresh-context review, before code.
  Execute D inline. This author invocation authorises neither code nor commits.
  D474's Slice J and contract proposal landed in PR #728; leave both sections and
  the proposal unchanged and unaccepted pending Waitron Lane B agreement. Display
  state is not permission. No new Waitron action, signed body, field, service name,
  lease lifetime or three/four-service negotiation; no local trading gate.
- Build permission rules and adapters with production enforcement **off**. No
  allowance sizes, pricing policy, retention/legal policy, billing worker, payment
  provider, invoice, emergency activation or live enablement. E owns allowances;
  G owns due transitions, extensions, reminders, paid-period cancellation and
  quiet-hour hosting stops. D provides an internal transition, not their scheduler.
  Level 3 permits a future hosting controller; D does not build or start one.
- Before **any source/test edit**, the driver compares proposed paths with each
  parked branch's merge-base diff, dirty files and planned reservations. Inspect
  actual three-way hunks against current main; a filename list is insufficient.
  The standing cross-branch exception covers only your own backlog paragraph.
  This plan author edits no backlog; the driver owns that paragraph.
- Current `main...refactor/remove-fiscal-registry` changes only its schema tests/
  fixture, migration-history test and backlog. Its planned deletion also reserves
  account-http `src/{app,server}.ts`, registration exports, fiscal tests, manifests,
  lockfiles and CI. Leave that work to D466; agree only additive permission-option
  hunks and export hunks or wait/rebase. No fiscal source, SQL, assertion or golden
  result belongs to D. Do not treat D466's parked tests as permission to proceed.
- `feat/test-cloud-integration` reserves `deploy/test-cloud/test-fixtures/integration-*`,
  `integration-receipt.test.mjs`, `scripts/{test-cloud-integration,verify-test-cloud-receipt}*`
  and `docs/test-cloud.md`. Coordinate D's runtime/receipt additions before touching
  their shared call sites; keep the integration fixtures and existing receipt
  versions intact. Do not edit that branch or claim its Waitron proof.
- AWS/P2 reserves `deploy/aws/**` and its workflow/plan; Kubernetes/P1 reserves
  `deploy/kubernetes/**`, `scripts/kubernetes-*` and its deployment plan. P3's
  country-split plan reserves registration policy/exports, migrations, account
  assembly and runtime schema ownership. Agree D's country-only permission interface,
  migration slot and additive assembly hunks with their drivers before those edits;
  D makes no infrastructure/provider/global-app changes. If P3 lands first, put
  D's assembly in its country app and update the file map before implementation.
- `feat/precise-ci-selection` reserves `.github/workflows/ci.yml`, `scripts/ci-*`
  and its plan/spec; D466 also reserves CI membership. D uses existing discovery,
  not CI edits. If new checks are omitted or exceed the current job budget, stop
  at that evidence gate for driver coordination. No foreign edits or invented
  owner gate follows. Recheck reservations after every intervening landing.

### Authority and compatibility decisions

Add a small country table `billing_service_authority`, keyed by
`(organisation_id,legal_business_id,venue_id)` with the composite venue FK from
045, `revision bigint NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991)` and
no cascading delete. Add `setup_grant_active boolean NOT NULL DEFAULT false` and
`setup_grant_until date`, with inactive implying a null end. These record the last
continuous level-2-or-higher grant window already observed by D; active/null end
means an unbounded base-level grant. They are derived from C facts, never another
level or expiry policy. Forbid identity changes, deletion, revision rewind or a
skipped generation with `55000`; derived-window bookkeeping may keep the revision.
Row existence means this venue has explicitly entered D's transition path;
revision is a durable generation that makes old writers invalid.
It stores no second level, price or payment policy. No backfill or default
activation. A known venue without that row has level 1 in the new mode, even if C
has recorded connected/hosted facts. This prevents storage-only fixtures or an
unqualified billing writer from silently enabling service access.

New `BillingStore.transition(scope,event,command)` enrols a **test** venue and
applies a venue permission command in C's existing event transaction. Keep
`execute` as the recording API for unenrolled venues. Once enrolled, both APIs
use the same internal transition hook for `set_venue`, `start_trial`,
`extend_trial`, `end_trial`; neither can bypass configuration invalidation.
`transition` and `execute` share event identity/content/replay rules. No second
receipt transaction, placeholder event, provider call or customer endpoint.
A replay cannot enrol or apply effects again. First enrolment needs a new internal
event, not replay of an earlier storage-only event. Unknown/foreign scope retains
`billing_scope_not_found`; trying to enrol a production venue gives
`permission_denied`, with no event or authority row.

Under the venue lock, compare permission facts before/after the command: stored
level plus each trial's level/start/end/state. First enrolment gives generation 1;
subsequent changes to these facts advance it once, including an extension that
changes the grant's time limit. A newly observed elapsed grant window also advances
it once. Coalesce both causes into one generation/configuration increment in the
same transaction. Same facts under another event advance it zero times unless an
elapsed window needs invalidating; exact event replay advances it zero times. C's billing venue revision still follows C's existing
set-command semantics; it is not the authority generation. Scheduled dates, payment observations, prices and display
fields confer no service grant. Guard revision overflow before effects. A generation
change advances each affected installation's configuration revision once in UUID
order. On losing level-2 permission, clear only `continuous_backup`,
`retained_snapshots`, `remote_access` to `state='unconfigured',configuration={}`.
Keep installation credentials and the stored translation entry. On upgrade, restore
none of those three automatically. Hosted-to-connected retains level-2 setup.

The permission reader combines the enrolled venue's stored base level with its
stored active trials: take the highest level whose half-open `[startedOn,endsOn)`
contains today. A registered venue with an active connected trial therefore has
level 2 without rewriting `billing_venues.level`; hosted trial gives 3. Before
start, on/after end, or after converted/lapsed outcome, that trial adds nothing.
An expired trial cannot prolong permission while G is delayed; a payment method,
paid-history bounding interval, pending charge or display `active` cannot convert
it. A connected base remains 2 after a hosted trial expires. Extension uses its
stored new end; no computed extension or automatic payment conversion here.
The new mode is test-only and uses the database clock's UTC civil day, read after
lock waits. Production country-calendar wiring must be qualified before any later
production mode is introduced; J's proposed calendar is not accepted by D.
Time expiry filters current grants even before G commits cleanup. Reprovisioning
always requires current permission and the current generation. Trial revocation
or extension cannot make an old generation current again.

Time can remove permission without changing C facts. Before a new-mode authority
read or a new permission command, take the venue `FOR NO KEY UPDATE` immediately,
then inspect the **previously stored** grant-window end against the fresh UTC day.
If an active finite window has ended, clear the same three setup rows, advance
the generation/configuration once and mark that window inactive before computing
current permission or applying the command. Then record today's derived window:
combine overlapping or touching active-trial intervals until the first uncovered
day; a connected/hosted base is unbounded. A gap invalidates setup even if no reader
or G ran during it and today falls in a later trial. An extension before the end
keeps setup; one after the old end first invalidates it. A command that removes
level-2 access also invalidates before storing the next window. Repeating the
same synchronisation makes no further revision change. Keep this bookkeeping in
the caller's transaction; rollback preserves all old facts/setup/generations and
returns no grant. Permission denial may roll it back, but the next successful
authority read/transition must repeat it before returning anything. No scheduler,
billing event or payment conversion is created by this read. Exact event replay
still returns its original receipt without effects; it cannot return a service
grant, and every service consumer synchronises independently.

| Mode/configuration | Exact behaviour |
| --- | --- |
| `existing`; legacy flag absent or `0`, new flag absent or `0` | Preserve current service behaviour; merely installing D or recording C facts grants/withdraws nothing. |
| `test-free-paid`; legacy `CLOUD_TEST_SERVICE_PLANS=1`, new flag absent/`0` | Preserve D79 free/paid matrix, including free translation, test-environment refusal and existing CLI. No reinterpretation or bulk conversion. |
| New `test-venue-levels`; `CLOUD_VENUE_SERVICE_LEVELS=test`, legacy absent/`0` | Use only enrolled venue authority plus C facts; organisation paid/free grants nothing here. Known unenrolled venue is registered/revision 0; unknown venue refuses. All venues must be `environment='test'`. |
| Both enabled, unknown/empty flag, `production`, `true`, whitespace or `1` for the new flag | Startup throws `invalid_plan_mode` before opening listeners/doing work. No production-enablement spelling is implemented. |
| DB/schema/clock/read failure | Propagate unavailable/defer; HTTP uses existing 503 failure handling, no synthetic registered/paid success and no cached authority. Storage reconciliation withdraws writers before reporting failure; failed reload means withdrawal incomplete. |

Keep `OrganisationPlanStore.show/set`, `planAllows`, `readOrganisationPlan`,
`requirePlanService`, `readVenuePlan`, `advancePlanConfiguration`,
`requireTestPlanVenue` and existing types/exports as legacy APIs. `requirePlanService`
and `readVenuePlan` must reject the new mode with `invalid_plan_mode`; do not return
`paid` as a stand-in for a venue level. `readOrganisationPlan` has no mode
argument: keep it legacy-only and remove it from new-mode paths.
`requireTestPlanVenue` validates test environment for both test modes.
Legacy configuration advancement excludes
enrolled venues, so an old org toggle cannot clear a paid sibling's setup. Legacy
mode refuses an enrolled venue rather than authorising it through the old switch.
The organisation CLI remains legacy-only and refuses new-mode invocation. No
bulk level setter or organisation entitlement is introduced.

## Slice E: allowances and remote-access traffic

You need bounded service use and trustworthy traffic measurements before trials
can use them. Build monthly allowance accounting beside the existing usage ledger,
then attach it to the existing admission points. Bytes measure traffic; they never
create a charge, payment, hosted day or invoice. This appendix implements design
§§2–4, 10, 11 and 13. It changes none of B–D or the unaccepted J proposal above.

### Publication, scope and source clearance

- This is **PLAN ONLY**. Publish this appendix separately, resolve a fresh-context
  plan review, and land it before runtime work. Execute inline under the driver;
  the author neither builds nor commits. Engineering choices below need no new
  owner approval. Production sizes remain the owner's §11 slots.
- C is delivered by PR #718, `3d3c3def00bf27d60f2d97f5c23cd4acc1aebf7d`.
  Inspection here is `afa917fe082c8e36ce2ae80b9cf0d9443d96b1a0`. D's landed
  plan is a contract for future work, not an installed API. D462 is parked at
  `defcb40020a52e1e6a7e857dcb990f0bd88a9070`, with only
  `venue-service-rules.ts` and its pure tests built. Do not import its unlanded
  reader/transition or copy its pure file into E.
- E1/E3 use new files and direct local imports, without registration exports,
  policy, runtime or migration edits. They can proceed independently of D.
  E2/E4 need source/slot clearance; E5 needs D's authority integration or an
  agreed narrow landing of those interfaces. This is a source dependency for
  those adapters, not a new dependency on all of D for pure rules or traffic.
  Parallel E/D execution is allowed only for disjoint agreed file sets.
- Before each shared-file edit, compare current main, each parked branch's
  merge-base changes **and dirty files**, then inspect actual three-way hunks.
  Agree exact interface/export/assembly hunks and landing order with D462/P3,
  P1 and D79's test-cloud driver, or wait/rebase. An empty current diff does not
  release a planned reservation. Preserve G's own D466 fiscal-removal work,
  historic `038_fiscal_allocation_registry.sql`, its history/schema tests and
  fiscal assertions. G can coordinate its own branches without another owner
  decision. J remains unaccepted and supplies no E API or calendar authority.
- Do not allocate 046: D462 proposed it and has not obtained a slot. Reconcile
  the actual SQL directory, `migrationNames`, backlog, P3 and both lanes' slot
  records before naming E's migration. Below, `<E-slot>_billing_allowances_traffic.sql`
  denotes that **single agreed filename**; record its exact predecessor hash,
  count and filename in the implementation receipt before E2's test-only push.
- P1 owns `deploy/kubernetes/**`/`scripts/kubernetes-*`; P3 reserves country
  policy, migrations, exports and account composition; D79 reserves
  `scripts/{test-cloud-integration,verify-test-cloud-receipt}*`, integration
  fixtures and `docs/test-cloud.md`. Do not edit those paths. Coordinate E's
  additive `app.ts`/server/runtime/export hunks, or mount in P3's country app
  if it lands first. Lane D's pinned-source-fetch repair owns cost/CI source
  files. No E changes to `.github/workflows/*`, `scripts/ci-*`, cost fixtures,
  install/source pins, manifests, lockfiles or package membership.
- Everything uses the trusted **country** registration pool, ES initially.
  Accounts, organisations, businesses and venues remain their existing local
  identities. No global customer, allowance service or new billing engine.
  Published configuration is internal; no publication HTTP API is added.
  Keep production enforcement OFF, existing modes unchanged and provider keys
  discarded. No live deployment, provider resources/accounts, spending, mail,
  payment, retention schedule or enforcement enablement follows from E.

### Accounting decisions

Use calendar months `[first day,next first day)` and UTC days in this **test-only**
slice. Read DB time after lock waits, not request time. No periodic counter reset
job: keys contain the month and history stays intact. Country production calendar,
IANA time zone, DST, provider traffic comparison and operational-origin inventory
need qualification before production; UTC fixtures do not settle those choices.

Publish immutable `AllowanceVersion` records with strictly increasing revision and
month-start effective dates. Select the greatest effective revision at the month's
first day; never apply a mid-month publication retroactively. Store the chosen
revision on each reservation. Missing configuration refuses new use. No migration
seeds, hardcoded sizes, prices or retention. The translation US$5 starting point
remains the existing independent `translation_policy` safety cap; do not turn that
historical value into a new production size. E's translation unit is a **requested
item**, chosen to bound admitted work without a new provider pricing system.

| Allowance service | Unit and debit boundary |
| --- | --- |
| `transactional_email` | One admitted message; debit retained on failure, cancellation, expiry or uncertain handoff, matching existing `RelayPolicy.debit='retain'`. Rollback before admission retains nothing. Account security/signup/reset mail is outside this gateway allowance. |
| `content_translation` | Number of items with missing translations in a newly admitted job. Hold all units at submit; spend once immediately before the first provider attempt. Review/retry/resume of that job uses that same admission. Release only a job proven never attempted; started, failed, partly done, cancelled or uncertain work retains its debit. |
| `sms` | Future outbound segment slot; no service built. |
| `rota_solver` | Future admitted solver-run slot; no service built. |
| `address_lookup` | Future confirmed-address workflow slot; no route/provider built. Separate provider request budgets still apply. |

At registered level, basic-service usage shares one country **account** month
across its organisations/venues. Connected/hosted limits apply per **venue**, never
per installation. An immutable reservation carries both identities for basic
services: account totals include all that account's basic-service debits, and venue
totals include all that venue's debits, across level changes. Select one current
limit, never add the account and venue allowances. Thus upgrades, downgrades,
replacement, payment-method changes and trial conversion cannot create a second
pot. They change the applicable ceiling, not usage. Two owners have separate
account budgets; neither can replay/rebind the other's message. Do not infer a
cross-country/global budget or solve ownership transfer here.

Only an active stored trial containing today, **and no current method**, selects
`trialAllowanceTier(false)` for translation/rota. Outside that interval select
full; within it with a method select `trialAllowanceTier(true)`. Email/SMS/address
never tighten because of trial status. Trial extension does not reset the month;
adding/removing a method raises/lowers the ceiling over the same held/spent units.
At equality, new reservations refuse `allowance_exhausted` until month rollover
or a legitimately higher configured ceiling; admission never spends a negative
balance. A reserved job may complete within its existing units. Permission,
consent and the money cap still independently stop further calls.

Lock account/credential/membership or existing request/message-identity prefixes
first as their current callers do. Then organisation SHARE, legal business SHARE
and billing business SHARE (C writers use NO KEY UPDATE), venue NO KEY UPDATE,
D's authority when installed, installations, service advisory locks, allowance
account keys then venue keys in UUID/service/month order, then job/reservation
rows. Service paths add the business reads **before** the venue to serialize
`set_method` with tier selection. Never acquire policy after a job/queue lock or
upgrade SHARE to UPDATE. C writers never acquire E bucket locks; E never calls
`BillingStore` methods that open another transaction. DB time and final proof,
session, owner, grant, lease and original identity rechecks follow waits. No new
transaction spans a network/model/SMTP wait. Use two-pool barriers, not sleeps,
to test ordering and races.

### Traffic decisions

Measure ingress plus egress **once at the outer HAProxy venue backend**, for
staff TCP and public TLS traffic. Ingress means client-to-gateway proxied bytes;
egress means the reverse. TLS overhead is included; IP/WireGuard overhead and
internal second-hop counters are excluded. Do not add frontend and backend totals
or count shared `public_gate` again. This is a transport measurement, not a
successful-login/action claim or the provider's invoice definition.

In explicit traffic test mode, render distinct staff/public **user** backends per
installation, plus operational backends selected first by exact trusted probe/
health/installation-worker source addresses from private collector configuration.
The public hop must retain PROXY v2, trusted overwritten headers, SNI selection,
connection limits and all gate checks. No request header/query can declare itself
operational or name a venue. Operational traffic is excluded from qualifying user
bytes, even if the probe solves the public challenge. Keep only aggregate counters;
no URLs, addresses, cookies, credentials, messages or content enter reports/rows.
Source-address classification needs a separately qualified production network
inventory; shared NAT with users, unknown operational origins or incomplete
mapping makes trial-use coverage unavailable, not inferred from total traffic.

Read HAProxy's private UNIX stats socket, not public HTTP metrics. Bind rows by
generated backend name to the installed signed route/revision. Each HAProxy child
gets a persisted random process UUID before it starts; never use PID alone as
restart identity. Keep distinct child/socket identities during graceful reload.
Parse header-named `bin`/`bout` unsigned decimal counters using bigint. First
snapshot is zero only for a verified newly started child; otherwise establish an
incomplete baseline and claim no historical delta. Increasing cumulative snapshots
become deltas; equal snapshots add zero, decreases/wrap/unknown reset mark a gap
and refuse a fabricated delta. Counter inputs are uint64; each delta sum must fit
PostgreSQL signed bigint (`9223372036854775807`), otherwise refuse with no wrap,
rounding or Number conversion. Missing/malformed/duplicate backend rows cannot
become zero-use evidence.

Sample once per second in fixtures; attribute each delta to the UTC civil day of
its **interval end**. A midnight-crossing sample belongs wholly to the new day;
there is no invented interpolation. A long-lived connection contributes sampled
bytes on each day it transfers them, not only at disconnect. Report this sampling
uncertainty in evidence and qualify it with the production calendar. Persist
baseline plus signed pending delta atomically with file/directory fsync before
advancing the exporter cursor. Retry exactly those bytes/identity after DB failure
or lost acknowledgement, including restart; remove only acknowledged spool files.
A crash before sampling can lose the unsampled tail: record an incomplete interval,
never claim exactly-once measurement of that tail. Bound each report to 128 entries
(64 routes with two channels)/262,144 bytes and configure a bounded private spool.
Full spool, missing checkpoint,
abnormal child exit or lost final reload sample marks a durable gap, emits a fixed
error and makes affected trial coverage unavailable. It must not block ordinary
trading or silently delete unacknowledged records. No retention/deletion job.

The collector accepts a distinct signed audience using the currently registered
Ed25519 reporter for the mapped country/cell/environment. Preliminary key lookup
is not authority: relock/reverify reporter generation/revocation, cell and route
bindings after waits. Persist process/sequence/checkpoint, source and ledger in
one country transaction. Accept exact replay before freshness/current-route checks,
but only after signature and original country/reporter identity validation; it
returns the original receipt with no effects, even after rotation. An unknown old
reporter report is refused; already accepted historical replay can be checked
against its saved public key/binding. Changed payload under an existing identity
conflicts. New stale-generation/foreign/rebound route reports cannot add usage.
Require the next contiguous sequence; gaps wait for durable retry. Historical
uncollected deltas crossing reporter rotation are explicitly incomplete, never
reattributed to a new installation or discarded as measured zero.

Ledger type is `remote_access.traffic_bytes`, source kind `remote_traffic_sample`,
positive quantity `ingressDelta+egressDelta`. Zero deltas update completeness only.
Use fixed source reference `<process-uuid>:<sequence>:<installation-uuid>:<staff|public>`
(under 256 characters); bind country/cell/generation/report digest in the source
row. Daily totals sum those immutable events by venue/day. There may be many
samples per day; exactly one **distinct day** contributes to trial use if its
accepted user sum is positive and it lies in the trial's stored half-open interval.
Three such dates yield `remoteTrafficDays:3`; repeated samples on one date yield
1. Health observations, probes, zero bytes and installation operations yield 0.
Completeness requires contiguous collection over the relevant trial interval and
every serving process, or durable evidence that no remote route was serving then.
An interval before instrumentation has no coverage; never backfill it from probes.
E4 stores an expected-route journal from the country publication path, separately
from exporter claims. Each row binds venue, manifest digest/expiry and expected
staff/public channels before publication. Removing a route cannot close its old
lifetime until its authority has expired or all serving processes acknowledge a
final sample. Failed/uncertain publication remains uncovered. Store signed
supervisor process start/end records, predecessor UUID and final sequence beside
those expectations. A new process never closes its predecessor.
For each expected route/channel/process lifetime, accepted intervals must start
at its recorded start, have `next.from === previous.until`, and reach its recorded
end or the queried trial boundary. Concurrent reload processes each need coverage.
Zero-byte intervals are positive evidence; an absent row is not. No reports,
silent exporters, unacknowledged intervals, unclosed predecessors and leading,
trailing or sequence-contiguous time holes return complete false, even if every
received report says complete true. A local gap file need not arrive to detect
a missing tail. A no-route interval needs the country journal plus expiry/final
sample evidence for all prior serving authority; current placement absence alone
proves nothing. Late instrumentation leaves the earlier trial interval uncovered.
Expose `{complete,usage}` for G; incomplete coverage never becomes an unused
trial/extension decision. One translation job with an observed provider-attempt
callback contributes one translation run; queued/rejected/released-unstarted jobs
contribute zero. A pre-call debit without that callback is uncertain: retain its
units and return complete false for trial usage, rather than claiming a run or
an unused trial. Rota remains zero until its future trusted integration records
real starts.

### Review focus

1. Two venues/installations racing the last account unit must admit exactly one,
   while a foreign owner cannot spend it (E2/E5).
2. Method/trial/level changes and month rollover must retain usage without a
   second allowance, and preserve the independent translation money cap (E1/E5).
3. Lost replies, child reload/restart, counter reset/overflow and midnight must
   never duplicate bytes or turn missing measurements into unused days (E3/E4).
4. A validly signed but stale/foreign/rebound reporter must add no event; genuine
   probes with positive TLS bytes must still yield zero trial days (E4).
5. Lease takeover, cancellation and accounting failure after a model response
   must not replay paid work, release spent allowance or lose recorded cost (E5).
