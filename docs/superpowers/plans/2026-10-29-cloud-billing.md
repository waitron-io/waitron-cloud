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

### Task B1: Calendar days, renewal dates, attempts and failure timelines

**Files:**
- Create: `packages/registration/src/billing-calendar.ts`
- Modify: `packages/registration/src/index.ts` (add one export line)
- Test: `packages/registration/test/billing-calendar.test.ts`

**Interfaces:**
- Produces:
  - `type CivilDate = string`: `YYYY-MM-DD`, a calendar day in the country's own calendar.
  - `type PaymentMethodKind = 'card' | 'direct_debit'`
  - `addDays(date: CivilDate, days: number): CivilDate`. Negative `days` go backwards.
  - `renewalDateIn(anchorDay: number, year: number, month: number): CivilDate`. `month` is
    1–12. `anchorDay` is 1–31, clamped to the month's last day.
  - `nextRenewalAfter(anchorDay: number, date: CivilDate): CivilDate`. The first renewal
    date strictly after `date`.
  - `renewalOnOrAfter(anchorDay: number, date: CivilDate): CivilDate`. The first renewal date
    on or after `date`.
  - `firstAttemptDate(renewal: CivilDate, method: PaymentMethodKind, today: CivilDate): CivilDate`
  - `firstChargedRenewal(anchorDay: number | null, chargeableFrom: CivilDate, method: PaymentMethodKind): CivilDate`.
    `chargeableFrom` is the day a venue's paid level 2 begins, normally the day after its
    trial. With no anchor (the business's first paying venue), it returns `chargeableFrom`
    itself, which becomes the anchor. Otherwise it returns the first renewal whose attempt
    date is on or after `chargeableFrom`, which is
    `renewalOnOrAfter(anchorDay, chargeableFrom + ATTEMPT_LEAD_DAYS[method])`.
  - `type PaidLevel = 'connected' | 'hosted'`
  - `type FailureTimeline = { retryDates: CivilDate[]; servicesStop: CivilDate }`
  - `failureTimeline(level: PaidLevel, method: PaymentMethodKind, renewal: CivilDate, firstFailure: CivilDate): FailureTimeline`
  - `refundTimeline(level: PaidLevel, method: PaymentMethodKind, learnedOn: CivilDate): FailureTimeline`.
    This is `failureTimeline(level, method, learnedOn + 7, learnedOn)`.
  - `const ATTEMPT_LEAD_DAYS = { card: 7, direct_debit: 10 } as const`
  - `const HOSTED_GRACE_DAYS = 30`
  - `const DIRECT_DEBIT_RETRY_SPACING_DAYS = 14`

- [ ] **Step 1: Write the failing tests**

```ts
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {addDays,renewalDateIn,nextRenewalAfter,renewalOnOrAfter,firstAttemptDate,firstChargedRenewal,failureTimeline,refundTimeline} from '../src/index.ts';

test('days are added across month and year ends, forwards and back',()=>{
 assert.equal(addDays('2026-12-28',7),'2027-01-04');
 assert.equal(addDays('2028-03-01',-1),'2028-02-29');
});
test('a renewal day of the 29th to the 31st falls on the last day of a shorter month',()=>{
 assert.equal(renewalDateIn(31,2027,2),'2027-02-28');
 assert.equal(renewalDateIn(31,2028,2),'2028-02-29');
 assert.equal(renewalDateIn(30,2027,4),'2027-04-30');
 assert.equal(renewalDateIn(31,2027,3),'2027-03-31');
});
test('the next renewal is strictly after the given day and returns to the anchor day',()=>{
 assert.equal(nextRenewalAfter(12,'2026-11-11'),'2026-11-12');
 assert.equal(nextRenewalAfter(12,'2026-11-12'),'2026-12-12');
 assert.equal(nextRenewalAfter(31,'2027-01-31'),'2027-02-28');
 assert.equal(nextRenewalAfter(31,'2027-02-28'),'2027-03-31');
});
test('a renewal on or after a day includes that day itself',()=>{
 assert.equal(renewalOnOrAfter(12,'2026-11-12'),'2026-11-12');
 assert.equal(renewalOnOrAfter(12,'2026-11-13'),'2026-12-12');
 assert.equal(renewalOnOrAfter(31,'2027-02-28'),'2027-02-28');
});
test('cards are first tried 7 days ahead and direct debit 10, never before today',()=>{
 assert.equal(firstAttemptDate('2026-12-12','card','2026-11-20'),'2026-12-05');
 assert.equal(firstAttemptDate('2026-12-12','direct_debit','2026-11-20'),'2026-12-02');
 assert.equal(firstAttemptDate('2026-12-12','direct_debit','2026-12-09'),'2026-12-09');
 assert.equal(firstAttemptDate('2026-12-12','card','2026-12-12'),'2026-12-12');
});
test('a venue is first charged on the first renewal attempted after it becomes chargeable',()=>{
 assert.equal(firstChargedRenewal(null,'2026-11-30','card'),'2026-11-30');
 assert.equal(firstChargedRenewal(12,'2026-11-30','card'),'2026-12-12');
 assert.equal(firstChargedRenewal(12,'2026-12-12','card'),'2027-01-12');
 assert.equal(firstChargedRenewal(12,'2026-12-02','direct_debit'),'2026-12-12');
 assert.equal(firstChargedRenewal(12,'2026-12-03','direct_debit'),'2027-01-12');
});
test('level 2 stops on the renewal date; a card is retried 4 days and 1 day before it',()=>{
 assert.deepEqual(failureTimeline('connected','card','2026-12-12','2026-12-05'),
  {retryDates:['2026-12-08','2026-12-11'],servicesStop:'2026-12-12'});
});
test('level 2 by direct debit is never retried before the renewal date',()=>{
 assert.deepEqual(failureTimeline('connected','direct_debit','2026-12-12','2026-12-08'),
  {retryDates:[],servicesStop:'2026-12-12'});
});
test('a hosted venue gets weekly retries for 30 days after the renewal date, then hosting stops',()=>{
 assert.deepEqual(failureTimeline('hosted','card','2026-12-12','2026-12-05'),
  {retryDates:['2026-12-12','2026-12-19','2026-12-26','2027-01-02','2027-01-09'],servicesStop:'2027-01-11'});
});
test('a hosted venue by direct debit is retried 14 days apart and never within 10 days of hosting stopping',()=>{
 assert.deepEqual(failureTimeline('hosted','direct_debit','2026-12-12','2026-12-08'),
  {retryDates:['2026-12-22'],servicesStop:'2027-01-11'});
});
test('a refunded direct debit starts the countdown a week after we learn of it',()=>{
 assert.deepEqual(refundTimeline('connected','card','2027-01-20'),
  {retryDates:['2027-01-23','2027-01-26'],servicesStop:'2027-01-27'});
 assert.equal(refundTimeline('hosted','direct_debit','2027-01-20').servicesStop,'2027-02-26');
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test packages/registration/test/billing-calendar.test.ts`
Expected: FAIL, because `addDays` is not exported from `../src/index.ts`.

- [ ] **Step 3: Implement `billing-calendar.ts` and export it**

Do the date arithmetic on UTC-midnight `Date` values, and format with `toISOString().slice(0,10)`;
a `CivilDate` carries no time zone. `failureTimeline` works like this:

- **Connected, card:** retries on `renewal − 4` and `renewal − 1`, but only those strictly
  after `firstFailure`.
- **Connected, direct debit:** no retries.
- **Hosted:** `servicesStop = renewal + HOSTED_GRACE_DAYS`.
  - **By card,** retries every 7 days from `firstFailure + 7`, kept while
    `≤ servicesStop − 1`.
  - **By direct debit,** retries every `DIRECT_DEBIT_RETRY_SPACING_DAYS` from
    `firstFailure + 14`, kept while `≤ servicesStop − 10`. The 14-day spacing is longer than
    a debit's estimated confirmation time; slice A must verify the provider's actual timing.
    Spacing alone does not prove settlement. Slice G refuses to send while a debit is pending.

Add to `index.ts`:
`export {addDays,renewalDateIn,nextRenewalAfter,renewalOnOrAfter,firstAttemptDate,firstChargedRenewal,failureTimeline,refundTimeline,ATTEMPT_LEAD_DAYS,HOSTED_GRACE_DAYS,DIRECT_DEBIT_RETRY_SPACING_DAYS,type CivilDate,type PaymentMethodKind,type PaidLevel,type FailureTimeline} from './billing-calendar.ts';`

- [ ] **Step 4: Run the tests to see them pass**

Run: `node --test packages/registration/test/billing-calendar.test.ts`
Expected: `ℹ tests 11`, `ℹ fail 0`.

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter @waitron-cloud/registration typecheck`. Expected: exit status 0.

```bash
git add packages/registration/src/billing-calendar.ts packages/registration/src/index.ts packages/registration/test/billing-calendar.test.ts
git commit -s -m "Billing rules: renewal dates, first attempts and failure timelines"
```

### Task B2: Trials

**Files:**
- Create: `packages/registration/src/billing-trials.ts`
- Modify: `packages/registration/src/index.ts`
- Test: `packages/registration/test/billing-trials.test.ts`

**Interfaces:**
- Consumes: `addDays`, `CivilDate`, `PaidLevel` (Task B1).
- Produces:
  - `const TRIAL_DAYS = 30`
  - `const TRIAL_EXTENSION_DAYS = 30`
  - `trialEnd(start: CivilDate): CivilDate`. The first day after the trial: `start + 30`.
  - `trialReminderDates(end: CivilDate): [CivilDate, CivilDate]`. That is `[end − 7, end − 1]`;
    the second is the trial's last day.
  - `type TrialUsage = { remoteTrafficDays: number; translationRuns: number; solverRuns: number }`
  - `trialWasUsed(usage: TrialUsage): boolean`
  - `trialAllowanceTier(hasPaymentMethod: boolean): 'trial' | 'full'`
  - `type TrialOutcome = 'extend' | 'convert' | 'lapse'`
  - `trialOutcome(input: { level: PaidLevel; hasPaymentMethod: boolean; usage: TrialUsage; alreadyExtended: boolean }): TrialOutcome`
  - `mayStartTrial(level: PaidLevel, history: { trialled: readonly PaidLevel[]; paid: readonly PaidLevel[] }): boolean`.
    A venue that has already tried, or already paid for, a level cannot try it. A failover
    never starts a trial; slices G and I never call this on that path.

- [ ] **Step 1: Write the failing tests**

```ts
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {trialEnd,trialReminderDates,trialWasUsed,trialAllowanceTier,trialOutcome,mayStartTrial} from '../src/index.ts';
const unused={remoteTrafficDays:2,translationRuns:0,solverRuns:0};

test('a trial lasts 30 days and reminds a week before and on its last day',()=>{
 assert.equal(trialEnd('2026-10-31'),'2026-11-30');
 assert.deepEqual(trialReminderDates('2026-11-30'),['2026-11-23','2026-11-29']);
});
test('remote access counts as used on three different days; one translation or solver run counts',()=>{
 assert.equal(trialWasUsed(unused),false);
 assert.equal(trialWasUsed({...unused,remoteTrafficDays:3}),true);
 assert.equal(trialWasUsed({...unused,translationRuns:1}),true);
 assert.equal(trialWasUsed({...unused,solverRuns:1}),true);
});
test('only a trial with no payment method has the tighter allowances',()=>{
 assert.equal(trialAllowanceTier(false),'trial');
 assert.equal(trialAllowanceTier(true),'full');
});
test('an unused connected trial is extended once, even with a payment method on file',()=>{
 assert.equal(trialOutcome({level:'connected',hasPaymentMethod:true,usage:unused,alreadyExtended:false}),'extend');
 assert.equal(trialOutcome({level:'connected',hasPaymentMethod:false,usage:unused,alreadyExtended:false}),'extend');
 assert.equal(trialOutcome({level:'connected',hasPaymentMethod:false,usage:unused,alreadyExtended:true}),'lapse');
 assert.equal(trialOutcome({level:'connected',hasPaymentMethod:true,usage:unused,alreadyExtended:true}),'convert');
});
test('a used trial converts with a payment method and lapses without one',()=>{
 const used={...unused,remoteTrafficDays:3};
 assert.equal(trialOutcome({level:'connected',hasPaymentMethod:true,usage:used,alreadyExtended:false}),'convert');
 assert.equal(trialOutcome({level:'connected',hasPaymentMethod:false,usage:used,alreadyExtended:false}),'lapse');
});
test('a hosted trial is never extended',()=>{
 assert.equal(trialOutcome({level:'hosted',hasPaymentMethod:false,usage:unused,alreadyExtended:false}),'lapse');
 assert.equal(trialOutcome({level:'hosted',hasPaymentMethod:true,usage:unused,alreadyExtended:false}),'convert');
});
test('each level can be tried once per venue, and not after paying for it',()=>{
 assert.equal(mayStartTrial('connected',{trialled:[],paid:[]}),true);
 assert.equal(mayStartTrial('connected',{trialled:['connected'],paid:[]}),false);
 assert.equal(mayStartTrial('connected',{trialled:[],paid:['connected']}),false);
 assert.equal(mayStartTrial('hosted',{trialled:['connected'],paid:['connected']}),true);
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test packages/registration/test/billing-trials.test.ts`
Expected: FAIL, because `trialEnd` is not exported.

- [ ] **Step 3: Implement `billing-trials.ts` and export it**

`trialOutcome` checks in this order:

1. `extend`, for a connected trial that is unused and not already extended.
2. Otherwise `convert` when `hasPaymentMethod`.
3. Otherwise `lapse`.

Add the `index.ts` export line for every name in the Interfaces block.

- [ ] **Step 4: Run the tests to see them pass**

Run: `node --test packages/registration/test/billing-trials.test.ts`
Expected: `ℹ tests 7`, `ℹ fail 0`.

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter @waitron-cloud/registration typecheck`. Expected: exit status 0.

```bash
git add packages/registration/src/billing-trials.ts packages/registration/src/index.ts packages/registration/test/billing-trials.test.ts
git commit -s -m "Billing rules: trial ends, reminders, use and outcomes"
```

### Task B3: Hosted-day amounts and a renewal's lines

**Files:**
- Create: `packages/registration/src/billing-charges.ts`
- Modify: `packages/registration/src/index.ts`
- Test: `packages/registration/test/billing-charges.test.ts`

**Interfaces:**
- Consumes: `CivilDate` (Task B1).
- Produces:
  - `type PriceList = { connectedMonthlyCents: number; hostedMonthlyCents: number }`
  - `hostedDaysCents(prices: PriceList, hostedDays: number, daysCoveredByConnected: number): number`.
    This is `(hostedDays × hosted − daysCoveredByConnected × connected) / 30`, rounded half
    up to a whole cent, and never below 0. Slice G uses it for the comeback amount as well.
  - `type VenueChargeView = { venueId: string; connectedFrom: CivilDate | null; hostedDays: number; hostedDaysCoveredByConnected: number }`.
    `connectedFrom` is the first renewal date at which the venue's level-2 month is
    charged; `null` means the venue has no level-2 subscription. The two day counts cover
    the period since the last charge.
  - `type RenewalLine = { venueId: string; kind: 'connected_month' | 'hosted_days'; quantity: number; cents: number }`
  - `renewalLines(renewal: CivilDate, prices: PriceList, venues: readonly VenueChargeView[]): RenewalLine[]`.
    Lines are ordered by `venueId`, then `connected_month` before `hosted_days`. A zero-cent
    line is left out.
  - `type ChargeTotals = { netCents: number; vatCents: number; grossCents: number }`
  - `chargeTotals(lines: readonly RenewalLine[], vatRateBasisPoints: number): ChargeTotals`.
    VAT is computed once, on the sum of the lines, rounded half up to a whole cent. The rate
    comes from configuration; Spain's standard rate is 2100 basis points.

- [ ] **Step 1: Write the failing tests**

```ts
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {hostedDaysCents,renewalLines,chargeTotals,type VenueChargeView} from '../src/index.ts';
const prices={connectedMonthlyCents:1000,hostedMonthlyCents:3000};
const venue=(venueId:string,over:Partial<VenueChargeView>={}):VenueChargeView=>({venueId,connectedFrom:'2026-11-12',hostedDays:0,hostedDaysCoveredByConnected:0,...over});

test('a level-2 venue that fails over pays only the difference for each hosted day',()=>{
 assert.equal(hostedDaysCents(prices,7,7),467);
});
test('a venue hosted from the start pays a thirtieth of the hosted price a day',()=>{
 assert.equal(hostedDaysCents(prices,30,0),3000);
 assert.equal(hostedDaysCents(prices,1,0),100);
});
test('the hosted amount is never negative',()=>{
 assert.equal(hostedDaysCents({connectedMonthlyCents:3000,hostedMonthlyCents:1000},2,2),0);
});
test('a venue whose paid month starts on this renewal date is charged on it',()=>{
 assert.deepEqual(renewalLines('2026-12-12',prices,[venue('b',{connectedFrom:'2026-12-12'})]),
  [{venueId:'b',kind:'connected_month',quantity:1,cents:1000}]);
});
test('a venue still in its trial or free days is not charged',()=>{
 assert.deepEqual(renewalLines('2026-12-12',prices,[venue('b',{connectedFrom:'2027-01-12'}),venue('c',{connectedFrom:null})]),[]);
});
test('one renewal carries each venue’s month and its hosted days, in venue order',()=>{
 assert.deepEqual(renewalLines('2026-12-12',prices,[venue('b',{hostedDays:7,hostedDaysCoveredByConnected:7}),venue('a')]),[
  {venueId:'a',kind:'connected_month',quantity:1,cents:1000},
  {venueId:'b',kind:'connected_month',quantity:1,cents:1000},
  {venueId:'b',kind:'hosted_days',quantity:7,cents:467},
 ]);
});
test('a fresh hosted venue is charged its hosted days alone',()=>{
 assert.deepEqual(renewalLines('2026-12-12',prices,[venue('h',{connectedFrom:null,hostedDays:30})]),
  [{venueId:'h',kind:'hosted_days',quantity:30,cents:3000}]);
});
test('VAT is added once on the charge total, rounded half up',()=>{
 const lines=renewalLines('2026-12-12',prices,[venue('b',{hostedDays:7,hostedDaysCoveredByConnected:7}),venue('a')]);
 assert.deepEqual(chargeTotals(lines,2100),{netCents:2467,vatCents:518,grossCents:2985});
 assert.deepEqual(chargeTotals([],2100),{netCents:0,vatCents:0,grossCents:0});
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test packages/registration/test/billing-charges.test.ts`
Expected: FAIL, because `hostedDaysCents` is not exported.

- [ ] **Step 3: Implement `billing-charges.ts` and export it**

Compute in integer cents: the numerator `hostedDays × hosted − covered × connected` is
exact, then divide by 30 with half-up rounding, `Math.floor((n + 15) / 30)` for `n ≥ 0`.
VAT is `Math.floor((net × rate + 5000) / 10000)`. Add the `index.ts` export line.

- [ ] **Step 4: Run the tests to see them pass**

Run: `node --test packages/registration/test/billing-charges.test.ts`
Expected: `ℹ tests 8`, `ℹ fail 0`.

- [ ] **Step 5: Run all three files, typecheck and commit**

Run: `node --test packages/registration/test/billing-calendar.test.ts packages/registration/test/billing-trials.test.ts packages/registration/test/billing-charges.test.ts`
Expected: `ℹ tests 26`, `ℹ fail 0`.
Run: `pnpm --filter @waitron-cloud/registration typecheck`. Expected: exit status 0.

```bash
git add packages/registration/src/billing-charges.ts packages/registration/src/index.ts packages/registration/test/billing-charges.test.ts
git commit -s -m "Billing rules: hosted-day amounts and renewal lines"
```

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

### File map and shared types

Create `billing-types.ts` for the declarations below, `billing-config.ts` for pure
validation and its price store, `billing-store.ts` for transaction/event orchestration
and business methods, `billing-venues.ts` for venue/trial/day operations, and
`billing-payments.ts` for charges/payment operations. The latter two take the existing
transaction's `PoolClient`; they never open a nested transaction. Export the public
interfaces through the existing `src/index.ts`. Public business/venue store reads/writes always take `BillingScope`; imports have no side effects.

Declarations below specify contracts, not function bodies. Reuse B's `CivilDate`,
`PaidLevel`, `PaymentMethodKind`, `PriceList`, `VenueChargeView`, `RenewalLine` and
`ChargeTotals`; do not redeclare them. All new declarations live in `billing-types.ts`.

```ts
type BillingScope = {organisationId:string; legalBusinessId:string};
type BillingLevel = 'registered' | PaidLevel;
type BillingProvider = 'sumup' | 'stripe';
type PaymentState = 'pending' | 'succeeded' | 'failed' | 'refunded';
type BillingPriceVersion = {revision:number; effectiveFrom:CivilDate; currency:'EUR';
  prices:PriceList; vatRateBasisPoints:number};
type ProviderMethod = {id:string; kind:PaymentMethodKind; provider:BillingProvider;
  providerAccountId:string; customerId:string; methodId:string; mandateId:string|null};
type BusinessBillingView = BillingScope & {anchorDay:number|null;
  anchorDate:CivilDate|null; revision:number; paymentMethod:ProviderMethod|null};
type VenueBillingView = BillingScope & {venueId:string; revision:number;
  level:BillingLevel; connectedFrom:CivilDate|null; lapsedOn:CivilDate|null;
  scheduledLevel:'registered'|'connected'|null; scheduledOn:CivilDate|null};
type TrialView = {level:PaidLevel; startedOn:CivilDate; endsOn:CivilDate;
  extended:boolean; state:'active'|'converted'|'lapsed'};
type PaidPeriod = {level:PaidLevel; chargeId:string; attemptId:string;
  from:CivilDate; until:CivilDate};
type VenueBillingHistory = {trials:TrialView[]; paid:PaidPeriod[]};
type BillingEvent = {key:string; occurredAt:string; source:
  {kind:'internal'} | {kind:'provider'; provider:BillingProvider; accountId:string}};
type HostedWindow = {from:CivilDate; through:CivilDate};
type FrozenCharge = BillingScope & {id:string; kind:'renewal'|'hosted_comeback';
  renewalDate:CivilDate; connectedUntil:CivilDate|null; window:HostedWindow;
  price:BillingPriceVersion; lines:RenewalLine[]; totals:ChargeTotals};
type PaymentObservation = {eventId:string; state:PaymentState; occurredAt:string};
type PaymentView = {attemptId:string; chargeId:string; method:ProviderMethod;
  requestKey:string; providerPaymentId:string|null; state:PaymentState;
  revision:number; succeededAt:string|null; observations:PaymentObservation[]};
type BillingCommand =
  | {type:'ensure_business'}
  | {type:'set_method'; method:ProviderMethod|null}
  | {type:'anchor'; on:CivilDate; mode:'initial'|'comeback'; expectedRevision:number}
  | {type:'set_venue'; venueId:string; expectedRevision:number;
      value:Pick<VenueBillingView,'level'|'connectedFrom'|'lapsedOn'|'scheduledLevel'|'scheduledOn'>}
  | {type:'start_trial'; venueId:string; level:PaidLevel; on:CivilDate}
  | {type:'extend_trial'; venueId:string; level:'connected'; expectedEnd:CivilDate}
  | {type:'end_trial'; venueId:string; level:PaidLevel; expectedEnd:CivilDate;
      outcome:'converted'|'lapsed'}
  | {type:'hosted_day'; venueId:string; on:CivilDate; coveredByChargeId:string|null}
  | {type:'freeze_charge'; chargeId:string; kind:'renewal'|'hosted_comeback';
      renewalDate:CivilDate; connectedUntil:CivilDate|null; window:HostedWindow; priceRevision:number}
  | {type:'begin_attempt'; chargeId:string; attemptId:string; methodId:string; requestKey:string}
  | {type:'observe_payment'; attemptId:string; providerPaymentId:string;
      state:PaymentState; expectedRevision:number|null};
type BillingValue = BusinessBillingView | VenueBillingView | TrialView | FrozenCharge
  | PaymentView | {venueId:string; on:CivilDate; coveredByChargeId:string|null};
type BillingReceipt = {eventId:string; value:BillingValue};
type BillingErrorCode = 'invalid_billing_input'|'billing_scope_not_found'
  |'billing_event_conflict'|'billing_state_conflict'|'billing_price_unavailable'
  |'billing_price_conflict'|'billing_charge_conflict'|'billing_trial_unavailable';
```

All IDs except opaque provider references/event keys/request keys are canonical UUIDs.
Dates must be real `YYYY-MM-DD` days; timestamps canonical UTC ISO strings. Opaque
references/keys are printable, nonempty strings of at most 256 characters. Reject extra
properties, including nested ones, before storing an event; there is no raw payload API.
C checks provider reference shape and ownership, not whether a provider issued them.
`sumup` supports card shape; `stripe` supports card or direct debit, so A's card fallback
needs no schema change. `mandateId` is required for direct debit and null for card.

### Task C1: Add the schema, types and explicitly published prices

**Files:**
- Create: `packages/registration/migrations/045_billing_store.sql` (after reservation check).
- Modify: `packages/registration/src/migrate.ts` (append one manifest entry only).
- Create: `packages/registration/src/billing-types.ts`, `packages/registration/src/billing-config.ts`.
- Modify: `packages/registration/src/index.ts` (exports only).
- Test: `packages/registration/test/billing-schema.test.ts`, `packages/registration/test/billing-config.test.ts`.
- Adjust release-tail assertions in `packages/registration/test/registration.test.ts`,
  `packages/registration/test/schema-compatibility.test.ts`,
  `packages/registration/test/backup-verification-migration.test.ts`,
  `packages/registration/test/forward-observations-migration.test.ts`, and
  `packages/translation/test/result-storage-upgrade.test.ts`.

**Interfaces:**
- Consumes: `migrate(pool:Pool):Promise<void>`, `migrationNames`, `transaction<T>` and B's types.
- Produces: shared declarations, `BillingError extends Error`, `constructor(code:BillingErrorCode)`
  with readonly `code:BillingErrorCode`, and `validateBillingPrice(value:unknown):BillingPriceVersion`.
- Produces: `BillingPriceStore` in `billing-config.ts`, `constructor(pool:Pool)`;
  `publish(value:BillingPriceVersion):Promise<BillingPriceVersion>`; `effective(on:CivilDate):Promise<BillingPriceVersion>`;
  `revision(revision:number):Promise<BillingPriceVersion>`.
- Produces internal `readBillingPrice(client:PoolClient, selector:{revision:number}|{on:CivilDate}):Promise<BillingPriceVersion>` for same-transaction reads.

- [ ] **Step 1: Write schema/config RED tests and the required consumer adjustments.**

Name the tests and pin these assertions:

- `billing schema rejects foreign ownership and retains billing parents`: mismatched
  business/organisation or venue/business inserts reject with SQLSTATE `23503`;
  deleting a referenced venue/business/organisation also rejects `23503`, leaving rows.
- `billing schema enforces uniqueness and immutable facts`: duplicate renewal per
  business/date, duplicate charge line, duplicate trial per venue/level and duplicate
  hosted venue/day reject `23505`; altering/deleting an event, published price, frozen
  charge/line, payment observation or paid-history row rejects `55000`.
- `billing schema rejects malformed numbers dates and states`: negative/fractional
  money, invalid anchor 0/32, invalid level/state and inverted intervals reject `23514`
  (use numeric columns with integral CHECKs for fractional-input assertions). Impossible
  SQL dates reject `22008` or `22007`; required nulls reject `23502`.
- `published prices have no defaults and validate whole safe cents`: pure validator
  returns the explicit test version; rejects missing/extra fields, NaN, fractions,
  negatives, unsafe arithmetic operands, non-EUR, revision 0 and invalid civil dates
  with `invalid_billing_input`. Use `Number.MAX_SAFE_INTEGER` as an overflow refusal.
- `price publication is immutable collision aware and effective dated`: absent price
  raises `billing_price_unavailable`; identical revision retry returns the same value;
  different contents under it raise `billing_price_conflict`; future prices do not
  apply early; concurrent same-revision publication inserts once. No migration seed.

Keep historical positions/digests and behavioral assertions in the five named existing
files. Compare current totals to `migrationNames.length`, assert the new tail and keep
044 at index 43; do not change their old prefix lengths or pinned historical releases.

- [ ] **Step 2: Observe RED before creating SQL, declarations or config implementation.**

Locally run only `node --test packages/registration/test/billing-config.test.ts` for pure
validation tests. Keep price-store database cases in `billing-schema.test.ts` so this
command never needs PostgreSQL. Commit tests with sign-off, then observe CI registration
fail on missing `billing_*` relations/exports. Record test name, head SHA and failure.
Old-tail failure alone does not satisfy new-schema RED.

- [ ] **Step 3: Implement the schema and configuration interfaces.**

Create these tables in the new SQL file, with explicit composite ownership keys:

| Table | Identity and stored facts |
| --- | --- |
| `billing_prices` | revision PK; effective day, EUR, both monthly cents, VAT basis points; immutable, no default production values |
| `billing_businesses` | PK `(organisation_id,legal_business_id)`; nullable anchor date/day, revision, nullable current method ID |
| `billing_payment_methods` | business scope + method UUID PK; kind and opaque provider/account/customer/method/mandate IDs; immutable |
| `billing_venues` | scope + venue UUID PK; current level, revision, connected start, lapse and optional scheduled change |
| `billing_trials` | scope + venue + level PK; start/end, extension flag and outcome; preserve original start |
| `billing_charges` | scope + charge UUID PK; kind/date, connected interval end, hosted window, complete frozen price/VAT/currency/totals |
| `billing_charge_lines` | scope + charge + venue + kind PK; B's quantity/cents; immutable |
| `billing_hosted_days` | scope + venue + civil day PK; nullable successful connected coverage charge, nullable consuming charge |
| `billing_payment_attempts` | scope + attempt UUID PK; charge/method, request key, payment binding, accepted state/revision, first success timestamp |
| `billing_payment_observations` | scope + attempt + event UUID PK; observed state/time; immutable |
| `billing_paid_periods` | scope + venue + level + charge PK; attempt, from/until; immutable |
| `billing_events` | event UUID; scope, source/provider/account/key, canonical command/time and stable result; immutable after insertion |

Add a unique `(id,organisation_id,legal_business_id)` key to existing `venues` in 045,
then reference it from billing venues. Reference the existing legal-business composite
key from billing businesses. Every child FK includes the complete business scope;
charge lines/paid periods/day coverage additionally bind their venue. Coverage references
that venue's fixed `connected_month` line key. Reference methods/attempts with the same scope. No FK uses `ON DELETE CASCADE`.
A partial unique index allows at most one `renewal` charge per business/renewal date.
Preserve separate comeback charges; their charge UUID and event key are their identities.
Provider request/payment references are unique per `(provider,provider_account_id,key)`
when present, and cannot be rebound across businesses. Event indexes are defined in C2.
Child references to the event being created are `DEFERRABLE INITIALLY DEFERRED`, so C2
can insert the complete immutable event after its effects within the same transaction.

Use whole safe numeric values, positive quantities/price revisions, nonnegative business/
venue/attempt revisions and prices, VAT 0–10000, paired anchor/date and scheduled level/date fields,
and half-open paid intervals `[from,until)`. Renewal charges require connectedUntil
strictly after renewalDate; comeback charges require it null. Monthly prices are at most
`Math.floor(Number.MAX_SAFE_INTEGER/10000)` cents. Check all multiplication/sum
intermediates before calling B; overflow refuses rather than rounding silently.
Freeze configuration/charge facts and immutable histories with triggers raising `55000`,
following the usage-ledger convention. Hosted coverage may move once from null to a
validated connected charge while its consuming charge is null; forbid coverage clearing,
replacement or changes after consumption (`55000`). Consumption itself moves once
from null to a charge and can never be cleared or replaced.
Any SQL helper that calls another helper must retain its schema search path as 043 does,
so empty-search-path `pg_restore` works. Do not alter `transaction.ts` or old SQL.

Publish prices under a schema-scoped transaction advisory lock, following `migrate.ts`'s
lock convention with a distinct `billing_prices` key. Equal revision/content retries
succeed; a reused revision with changed data refuses. New revisions and effective dates
increase strictly. Read the greatest effective revision on/before the requested day;
these methods run only in the trusted country DB. Notice/activation policy belongs to G.

- [ ] **Step 4: Observe GREEN and repeat migration checks in CI on the implementation head.**

Require named registration schema/consumer and translation upgrade tests, nonzero counts
and zero failures. Locally run the pure config file and `pnpm typecheck` only.

- [ ] **Step 5: Commit C1 with sign-off and retain its RED/GREEN SHAs for final readback.**

### Task C2: Scope every operation and commit events with their effects

**Files:**
- Create: `packages/registration/src/billing-store.ts`.
- Modify: `packages/registration/src/index.ts` (exports only).
- Test: `packages/registration/test/billing-store.test.ts`.

**Interfaces:**
- Consumes: C1 types/prices, `transaction<T>(pool,action)`, existing identity tables.
- Produces: `BillingStore`, `constructor(pool:Pool)`;
  `execute(scope:BillingScope,event:BillingEvent,command:BillingCommand):Promise<BillingReceipt>`; `business(scope:BillingScope):Promise<BusinessBillingView>`.
- Produces internal `BillingContext = {client:PoolClient; scope:BillingScope; eventId:string; occurredAt:string}` in `billing-types.ts` for C3/C4 handlers.
  Those handlers return `Promise<BillingValue>` to the single event transaction.

- [ ] **Step 1: Write the scoped event/business RED tests.**

- `every billing read and command fails closed on unknown or foreign scope`: exercise
  all C2–C4 public reads and command variants with unknown IDs, another organisation,
  and a different business in the same organisation; expect `billing_scope_not_found`,
  no returned row, and unchanged counts/revisions/events. Complete the matrix as C3/C4
  land. No public read accepts a charge/attempt/venue UUID without business scope.
- `event retry returns the committed receipt after reconnect`: same key, scope, source,
  occurrence time and command on a fresh pool returns `deepEqual(receipt,original)`;
  row counts and revisions stay unchanged. Object property order is immaterial.
- `changed event payload refuses without effects`: change command value, occurrence
  time, referenced venue, or command type under the same key; expect
  `billing_event_conflict`, preserving original receipt and every business row.
- `provider events are unique within provider account and cannot cross businesses`:
  same provider/account/key under another business refuses `billing_event_conflict`;
  different provider or account may reuse a key. Internal keys may repeat in another
  business; internal and provider sources never collide. Check the SQL unique indexes.
- `event insertion and effects roll back together`: in the owned test schema inject a
  failing trigger after the business update, then one on event insertion; expect each
  sentinel SQL error and identical pre/post snapshots. Remove the test-owned trigger;
  the same command/key succeeds once. Do not add a production failure-injection option.
- `concurrent first venues share one anchor and stale comeback refuses`: race initial
  anchors for the 12th/19th on two pools; both return the winner's day/date, never a
  mixture, using bounded `pg_stat_activity` barriers, not sleeps. Existing anchor survives another initial call. An explicit comeback with
  current revision changes both once; stale expected revision raises `billing_state_conflict`.
- `method switching retains only opaque references and old history`: select card, then
  direct debit, then clear; old methods remain, current pointer matches; rebinding a
  method ID/provider reference refuses. Extra `iban`, `cardNumber` or `apiKey` input
  raises `invalid_billing_input` before any row/event exists; errors contain fixed codes.

- [ ] **Step 2: Commit tests and observe the C2 RED in CI before implementation.**


- [ ] **Step 3: Implement event orchestration and business commands only.**

Validate fixed-shape inputs first; resolve the existing business and ownership under
lock before exposing replay results. `ensure_business` creates a null anchor/method;
other commands require that row. `business` returns no synthetic foreign/default row.
`set_method` saves/selects an immutable method or clears the pointer without erasing it.
An initial anchor sets date/day only while null; competing initial requests return the
winner without moving it, even if their expected revision is now stale. A comeback
requires the exact business revision; G decides when that reset is appropriate.

Use one `transaction(pool,...)` per execute, and this lock order: organisation `FOR SHARE`
(the existing policy lock), existing legal-business `FOR NO KEY UPDATE`, billing business,
event identity, billing venues in UUID order, charges/attempts in UUID order, then hosted
rows in `(venue,day)` order. Mutating child rows use `FOR NO KEY UPDATE`; read projections
use the same parent order and a business `FOR SHARE` lock for a consistent snapshot.
Business locking serialises empty-child inserts and first anchors without lost updates.
C does not lock installations/services; later D must preserve policy-before-service order.
Do not hold these locks over an external await/provider request.

Internal event uniqueness is `(organisation_id,legal_business_id,key)` for internal
sources; provider event uniqueness is `(provider,provider_account_id,key)` country-wide,
with owner scope stored and checked, not included in that unique key. Providers can
reuse IDs across accounts; an event for a different business cannot be applied twice.
Use explicit partial unique indexes, not nullable columns in an ordinary unique key.
Compare canonical fixed-shape command, source, scope and occurrence time on conflict;
never accept `ON CONFLICT DO NOTHING` alone as proof of an identical retry. Canonical
JSON sorts object keys and preserves array order; no raw webhook bytes are retained.

Within the same transaction compute effects and receipt, then insert the complete
immutable event. A concurrent provider-key conflict must compare the winner or refuse
and roll back the losing business's effects. Never commit a placeholder event or open
another transaction for its effects. SQL errors and lost connections leave neither.
Same-payload replay returns the original receipt even after later legitimate state
changes; do not reapply expected-revision checks to an already committed replay.

- [ ] **Step 4: Observe C2 GREEN in CI, including races observed through `pg_stat_activity`.**


- [ ] **Step 5: Commit C2 with sign-off and record exact-head CI evidence.**

### Task C3: Store venue levels, independent trials and hosted days

**Files:**
- Create: `packages/registration/src/billing-venues.ts`.
- Modify: `packages/registration/src/billing-store.ts`, `packages/registration/src/index.ts`.
- Test: `packages/registration/test/billing-venues.test.ts`.

**Interfaces:**
- Consumes: `BillingContext`, C2's execute boundary, B's `trialEnd`, `addDays`,
  `TRIAL_EXTENSION_DAYS` and `mayStartTrial`.
- Produces internal `applyVenueCommand(context:BillingContext,
  command:Extract<BillingCommand,{type:'set_venue'|'start_trial'|'extend_trial'|'end_trial'|'hosted_day'}>):Promise<BillingValue>`.
- Adds to `BillingStore`: `venue(scope:BillingScope,venueId:string):Promise<VenueBillingView>`;
  `history(scope:BillingScope,venueId:string):Promise<VenueBillingHistory>`;
  `renewalViews(scope:BillingScope,window:HostedWindow):Promise<VenueChargeView[]>`.
- Produces internal `readRenewalViews(context:BillingContext, window:HostedWindow):Promise<VenueChargeView[]>`, reused by C4 in its transaction.

- [ ] **Step 1: Write venue/trial/day RED tests.**

- `venue billing defaults only for a known owned venue`: an owned unstored venue reads
  registered/revision 0 with null dates; foreign/unknown reads refuse. First set requires
  revision 0; stale revision refuses without an event. Stored changes affect no D79 row,
  installation configuration, service state, backup or fiscal record.
- `trials are once per level independently and never paid history`: start connected
  without a method; ends on `trialEnd(on)`, has no charge/paid row. Repeating with a
  new event refuses `billing_trial_unavailable`. Hosted remains independently eligible,
  and the reverse order also works. Starting a trial changes neither current level nor
  business anchor automatically; G composes those decisions.
- `only an active connected trial extends once by thirty days`: expected end must match;
  new end is `addDays(oldEnd,30)`, original start unchanged; repeated extension, hosted
  extension or extension after outcome refuses. `end_trial` records its supplied
  converted/lapsed outcome without payment, lapse timers, email or hosting operations.
- `hosted days are unique and coverage advances only before consumption`: repeat the
  same venue/date/coverage under a fresh event returns its current value. An unconsumed
  day with null coverage may gain one valid connected charge through `hosted_day`;
  clearing or replacing coverage, or changing it after consumption, refuses
  `billing_charge_conflict`. Coverage must refer to this venue's connected-month line,
  a succeeded payment and a paid interval including that day; pending/failed payment,
  another venue/business or an out-of-period day cannot provide coverage.
- `renewal views contain each venue once without joined row multiplication`: two venues,
  two trials, several payment observations and hosted rows still produce two sorted
  views. Inclusive hosted window contains only unassigned days: assert hosted counts
  3/2 and covered counts 2/0, and that covered count never exceeds hosted count.
  Owned registered venues appear with null `connectedFrom`; unknown scope refuses.

- [ ] **Step 2: Commit tests and observe C3 RED in the CI registration job.**

Seed coverage prerequisites through C1's real SQL tables, including successful payment
and paid-period fixtures; C3's tests do not need C4 handlers. Observe the named coverage
refusal failures before implementing their guards, not skipped or deferred assertions.

- [ ] **Step 3: Implement venue commands and projections under C2's transaction.**

Create a billing-venue row only for an existing composite-owned venue; reads may project
an owned missing row's registered defaults. Require matching venue revision for level/
scheduled-date writes; C stores the supplied state, not the permission to activate it.
Trials survive lapse, return and method changes. Use history's exact paid level with
`mayStartTrial`, so paying connected never consumes hosted eligibility. C4 supplies
paid facts at runtime; C3 tests use SQL fixtures. Unsuccessful attempts, current level
and trial conversion alone do not count as payment.

Hosted rows represent caller-reported billable days, including zero incremental-price
covered days; G decides trial/grace/return-day policy before calling. Validate coverage
against a successful connected charge/period, not `connectedFrom` alone. Before consumption,
`hosted_day` may assign valid coverage to a previously uncovered day after a late payment.
Its event receipt preserves that operation's result; later reads show the current row.
Freeze coverage when the day is consumed, and never replace or clear assigned coverage.
A later refund does not rewrite that historical coverage or consume the hosted day again;
G decides its consequences. A hosted row's consuming charge is null until C4 assigns it,
then cannot change or clear (`55000`). Keep independent aggregate queries for hosted
counts and one base venue row so histories cannot multiply `VenueChargeView` results.

- [ ] **Step 4: Observe all C3 tests GREEN in CI, including SQL-seeded coverage cases.**

Locally run `pnpm typecheck` and B's three unchanged pure test files.

- [ ] **Step 5: Commit C3 with sign-off and retain exact-head CI evidence.**

### Task C4: Freeze charges and record attempts, observations and paid history

**Files:**
- Create: `packages/registration/src/billing-payments.ts`.
- Modify: `packages/registration/src/billing-store.ts`, `packages/registration/src/index.ts`.
- Test: `packages/registration/test/billing-payments.test.ts` and C3's retained coverage cases.

**Interfaces:**
- Consumes: C1–C3 types/context, B's `renewalLines`, `hostedDaysCents`, `chargeTotals`.
- Produces internal `applyPaymentCommand(context:BillingContext,
  command:Extract<BillingCommand,{type:'freeze_charge'|'begin_attempt'|'observe_payment'}>):Promise<BillingValue>`.
- Adds to `BillingStore`: `charge(scope:BillingScope,chargeId:string):Promise<FrozenCharge>`;
  `payments(scope:BillingScope,chargeId:string):Promise<PaymentView[]>`.
  These return only scoped records; no unscoped provider/event lookup is public.

- [ ] **Step 1: Write charge/payment RED tests.**

- `one renewal freezes unique ordered lines prices and VAT`: at the fixture version,
  two connected venues plus seven hosted days all covered by connected give net 2467,
  VAT 518 and gross 2985. Assert B's exact ordered lines and one `(charge,venue,kind)`
  row each. Publishing another price version changes none of the saved values.
- `concurrent renewal creation and day allocation cannot double charge`: two new event
  keys/charge IDs for one business/date yield one charge; the loser raises
  `billing_charge_conflict` with no event. A later renewal/comeback cannot reuse assigned
  hosted days, including a day in a zero-cent omitted hosted line. Different businesses
  can share a renewal date. A direct duplicate SQL insert raises `23505`.
- `comeback charges contain hosted arrears only`: even for a venue with connectedFrom,
  a `hosted_comeback` omits connected-month lines and uses B's hosted-day calculation.
  Empty/zero-total charge refuses `billing_charge_conflict`; no provider attempt exists.
- `failed final line insert rolls back charge day assignments and event`: inject a
  failing line trigger in the owned schema; compare all four table snapshots after
  refusal; retry after removing it produces exactly one complete charge.
- `pending failed succeeded and refunded observations preserve accepted state`:
  pending attempt has no paid history; accepted failure still has none; explicit
  current-revision success sets first success time once. Pending/failed observations
  with `expectedRevision:null` remain in history without changing accepted success.
  Attempting to accept them raises `billing_state_conflict`; explicit success-to-refund
  keeps first success time; refund observed before success may be stored history-only
  but cannot be accepted without prior success, and refunded cannot regress. C emits no
  emails, invoices, debt, retry, stop or renewal reset.
- `payment bindings and revisions refuse races`: reused provider request/payment ID
  under a different attempt/business refuses, pending attempt is durable before any
  external submission, changed method does not rewrite the attempt's method snapshot,
  and stale expected revision cannot replace an accepted observation.
- `paid history requires actual successful venue lines and survives a refund`: saved
  paid history must match the attempt/charge/venue/level and accepted success; pending,
  failure or trial cannot create paid rows. First accepted success inserts each matching
  venue/level period in the same event transaction, so a concurrent trial cannot slip
  through before history exists. Retrying success adds no periods; refund retains them.
  Retrying a same-level trial now raises `billing_trial_unavailable`, independently
  for connected and hosted; the other level stays eligible until separately used.
- `late connected payment credits still-unbilled hosted days`: create a pending
  connected payment and four uncovered hosted days within its period. Coverage refuses
  while pending/failed; accept success and its paid history, then assign coverage through
  `hosted_day` before freezing the later charge. At fixture prices its hosted line is
  267 cents, not 400. Repeated assignment is idempotent; replacement, clearing and
  post-consumption changes refuse, preserving the frozen line and original event receipts.
- `unpaid coverage and unsafe charge arithmetic refuse without partial effects`:
  assert C3's coverage cases and overflow input refusal with unchanged rows/events.

- [ ] **Step 2: Commit tests and observe C4's named database RED in CI.**

Record the test-only head and named behavior failure before implementing its handler.

- [ ] **Step 3: Implement the payment handler and exercise C3's guards through it.**

Freeze under the business/venue locks, using `readBillingPrice` and `readRenewalViews`
on the existing context/client. For renewal, calculate B's lines at renewalDate;
for comeback, supply null connected starts to exclude monthly charges. A requested price
revision must equal the effective revision at renewalDate. Validate interval bounds
and safe arithmetic, compute totals once, save the whole version on the charge, then allocate all selected hosted days,
including zero-cent ones. Do not recompute historical charges on reads or replays. Both daily rates come from the selected bill version under B3; earlier charges retain their own snapshots. A different basis for credits after a price change requires a separate pricing-rule amendment, not a silent change in C.

Persist a local pending attempt and its immutable method binding before F ever submits
it; C does not send or decide whether another attempt is due. Every observation appends
history tied to the current event. Provider-source events must match the attempt's
provider/account; only `observe_payment` accepts a provider event source. `expectedRevision:null` means history only; a numeric value asks to
accept with a compare-and-set on that revision. Permit pending-to-succeeded/failed,
failed-to-succeeded correction and succeeded-to-refunded acceptance, plus same-state
observations. Acceptance increments attempt revision; history-only writes leave accepted state and its revision unchanged. The first observation may bind the immutable provider payment reference even when it does not accept a state transition; later observations must retain that binding.
Never accept succeeded-to-pending/failed or any reversal of refunded.
Do not sort webhooks by timestamp or infer provider precedence. F validates authenticity
and decides which observation to propose for acceptance; G decides effects and retries.

On first accepted success, append paid periods for matching nonzero venue lines within
that same transaction; first success remains provable after refund. Connected periods
use renewalDate/connectedUntil; hosted periods use that venue's minimum assigned day
through one day after its maximum, without claiming connected coverage. History retains
exact hosted dates in the assigned day rows. No success changes the current venue level,
consumes the other level's trial, issues an invoice or starts service. Protect provider
bindings, first success and frozen amounts against direct SQL regression. Hosted paid-period dates bound the allocated days; the exact days remain in `billing_hosted_days`. Those summary bounds must not grant continuous hosting or connected coverage across gaps.

- [ ] **Step 4: Observe all C2–C4 matrix and concurrency tests GREEN on this CI head.**

Read registration job output for C3's retained coverage cases too; require no skips. Locally
run `pnpm typecheck` and the four pure billing files (B plus C's config validation).

- [ ] **Step 5: Commit C4 with sign-off and retain its exact-head receipts.**

### Task C5: Qualify the actual upgrade, recovery and omission boundaries

**Files:**
- Create: `packages/registration/test/billing-migration.test.ts`,
  `packages/registration/test/billing-upgrade-recovery.test.ts`,
  `packages/registration/test/billing-guard-qualification.test.ts`.
- Modify: `packages/registration/test/fixtures/migration-release.ts` (add pinned 44 release).
- Create: `scripts/schema-upgrade-billing-fixture.mjs`.
- Modify: `scripts/schema-upgrade-fixture.mjs`, `scripts/schema-upgrade-fixture.test.mjs`,
  `scripts/schema-upgrade-receipt.mjs`, `scripts/verify-schema-upgrade-receipt.mjs`,
  `scripts/verify-schema-upgrade-receipt.test.mjs` (add separate billing proof mode).
- Modify: `scripts/database-recovery-migrations.test.mjs` (selected-release assertions).

**Interfaces:**
- Consumes: actual old 044 release `1a3e43e885edfbe9932c835e3f4fb8929718b2dc`, candidate
  commit, the existing `migrationRelease`, `checkConsumerSchema(pool,root)`,
  `hasReleaseMigrationCount(count,manifest)` and versioned receipt verifier.
- Produces in the new billing fixture: `seedBilling(root,pool,state):Promise<object>`,
  `billingState(pool):Promise<object>` and
  `restoredBilling(root,pool,proof,expected):Promise<void>`; objects are private synthetic
  fixture state, never arbitrary production payloads or fields in the public receipt.
- Extend `upgradeRevisions(args)` with mutually exclusive `--billing`, requiring complete
  distinct pinned `--old`/`--new` hashes and returning `billing:true,factor:false`.
- Add receipt `schemaVersion:6`, exactly 44→45 provisionally, with `billingStore` boolean
  checks listed below. Versions 1–5 and their historical counts remain unchanged.

- [ ] **Step 1: Write upgrade/recovery/guard RED tests before extending the proof.**

- `044 upgrades to billing without changing old rows or digests`: use the pinned old
  release's actual migrate function/SQL, seed two organisations, businesses and venues,
  encrypted mail/registration state, then migrate concurrently and again. Assert every
  old row plus all 44 name/digest/applied_at receipts unchanged, total equals current
  manifest, precisely one new ledger row, billing tables empty and D79 unchanged.
- `interrupted billing migration rolls back DDL and ledger then retries`: block the
  ledger insert, observe the migration backend waiting, terminate only that owned
  backend, verify no billing table/partial venue constraint or new ledger row survived,
  preserve old rows, then retry successfully. Match the monitoring/backup test pattern.
- `billing consumers refuse missing changed and future ledgers`: use the actual
  deployment schema checker, assert `schema_incompatible` and no writes for each case;
  current complete ledger passes, changed SQL digest makes migrate refuse
  `Applied migration has changed: <name>`. Keep recovery count helper manifest-driven.
- `billing upgrade mode requires a distinct pinned pair`: missing/duplicate flags,
  symbolic refs and combination with another proof mode raise `/revisions/`.
- `billing receipt requires every independent upgrade and restore fact`: reject missing,
  false or truthy-string evidence, unknown fields, wrong counts, equal heads/digests,
  dirty driver and nonzero cleanup with `/schema_upgrade_receipt/`.
- `billing guards detect omissions against real PostgreSQL`: run baseline refusal cases
  for composite ownership, event-payload collision, immutable line snapshot and accepted
  payment regression. In separate disposable schema/source copies omit exactly the
  corresponding FK/comparison/trigger/acceptance guard; the relevant behavioral case
  must fail. Require four detected omissions and baseline GREEN; never mutate the
  feature checkout or weaken its tests. Fail closed if a mutation matches zero/multiple
  locations. CI executes these controls; a source-text assertion is not qualification.
- `billing exact-head upgrade and recovery receipt is qualified`: the CI-discovered
  wrapper invokes the extended proof with the pinned old hash and `git rev-parse HEAD`
  as new/driver. Use one explicitly bounded 360-second test for this full receipt;
  ordinary store tests retain the package's 30-second default. Save only sanitized
  receipt evidence, never generated keys. Reject a receipt for any other candidate.

- [ ] **Step 2: Observe the new database RED in CI and pure verifier RED locally.**

Run locally: `node --test scripts/schema-upgrade-fixture.test.mjs scripts/verify-schema-upgrade-receipt.test.mjs scripts/database-recovery-migrations.test.mjs`.
Expect missing billing mode/version failures. The test-only CI head must also exercise
and fail the actual billing migration/proof boundary; passing validators alone are not
RED evidence for upgrade execution. Do not launch Docker or the proof locally.

- [ ] **Step 3: Extend the existing stopped-consumer proof without relabelling history.**

Add mode 6 alongside, not in place of, the 26→27, 34→35, 35→36, 36→37 and 42→43 modes.
Retain the common receipt checks except inapplicable `pairingUpgraded`, and require
`accountStatePreserved`, `relayStatePreserved`, `monitoringStatePreserved` as mode 5 does.
The `billingStore` section has exactly these true booleans: `oldSqlUnchanged`,
`oldRowsPreserved`, `emptyBillingAfterUpgrade`, `restartIdempotent`, `billingRowsPreserved`,
`pricesFrozen`, `eventRetryStable`, `eventCollisionRefused`, `foreignScopeRefused`,
`newBackupRestored`, `restoredPayments`, `restoredTrials`, `restoredHostedDays`,
`restoredEvents`, `restoredPrices`, `restoredRetryStable`, `oldBackupUpgradeEmpty`.

Run the old consumer before upgrade and refuse the new one against old/interrupted
schema. Interrupt the real migration, verify rollback, retry, refuse old consumer on
new schema and start the new one. Preserve identity, account/factor, relay, monitoring,
backups, completion retries, pending encrypted mail and tenant isolation using the
existing fixture functions. Compare old table names separately: new empty billing tables
must not make whole-table-map equality fail or conceal a changed old row.

Take separate pre-upgrade and populated post-upgrade logical backups. Seed all C tables,
including independent trials, paid/refunded history, covered/assigned hosted days,
immutable lines, two prices and replayable events. Restore the old backup into another
isolated DB and run the old consumer with matching external synthetic keys; wrong keys
must refuse. Upgrade that restored old DB and verify billing starts empty. Restore the
new backup separately with `pg_restore --exit-on-error` and its empty search path;
assert exact billing rows, scope refusals, preserved first success/refund, frozen prices
and same receipt on retry without additional rows. Preserve the original upgraded DB.
Retain `privateObservationDumpArgs`; do not put credentials in either receipt or logs.
No reverse migration, overwrite of the upgraded database or live recovery claim.

`hasReleaseMigrationCount` and local-stack verification already use the selected
manifest; add actual-manifest count/missing/extra tests without hardcoding 45 into those
helpers. `deploy/local-stack/runtime.mjs` and `deploy/test-cloud/account-worker.mjs`
already read the manifest; verify them through existing package/receipt coverage rather
than editing them. No fiscal consumer edits or reserved CI changes are required by C.

- [ ] **Step 4: Require GREEN and guard/recovery receipts on the exact candidate CI head.**

The registration glob must execute all three C5 files, including the proof wrapper;
inspect package output and the sanitized receipt. Read the
`changes` plan and every selected job. Require root shards `root (1/4)` through
`root (4/4)`, `typecheck`, selected package shards (including registration/translation),
selected `receipts`, and `summary`, plus any selected documentation/scripts job.
Do not infer a full proof from `test:local-stack`: its existing schema tests primarily
validate fixtures/verifiers; the new package wrapper must execute the actual 44→45 run.
If a receipt suite is omitted/reused, inspect its audited-input/reuse evidence on this
head. Missing new billing tests, skipped controls, old-head receipts or failed proof
execution block readiness even if the summary is green. Do not edit CI to bypass this.

Run focused native checks: `pnpm typecheck`, the four pure billing/config files, and
C5's named fixture/verifier/recovery-count tests. Let the normal push hooks run once,
then read all selected exact-head CI jobs, including its root shards. Do not duplicate
CI's whole-root suite locally solely to finish this branch. Focused tests must execute
nonzero cases with no unexpected skips. Database and guard proofs stay CI-only until
local Docker is available; do not substitute mocks.

- [ ] **Step 5: Commit with sign-off and hand back to the driver's normal branch lifecycle.**

Use normal hooks, the required finish-branch review and all exact-head final CI before
landing; after fixes/rebase inspect the changed result and qualify the new head again.
Report the branch ready to run `finish-branch` once the evidence is complete. No live
provider, invoice, enforcement or hosting enablement follows from C's success.

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
The design is approved (§5); the wire proposal below still needs agreement.
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
  proposes the [exact contract draft](../specs/2026-10-29-billing-display-contract-proposal.md)
  to Waitron Lane B for A1185 and records the accepted text's
  digest, both source pins and agreement. Only then land that section in
  `docs/waitron-integration-contract.md` and begin J's code. This author writes
  neither campaign questions nor acceptance. Plan publication is not agreement.
  The draft is versioned here so the plan has no dependency on local campaign files.
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

### Coordination and file map

Put pure rules/types in new registration `src/billing-display.ts`, transactional
machine reads in new `src/billing-display-machine.ts`, and the HTTP adapter and
explicit country/calendar options in new account-http `src/billing-display.ts`.
Use existing package exports, with additive lines only. Mount the exact path in
`packages/account-http/src/app.ts` before its generic installation dispatcher.
Leave `installations.ts`, existing configuration bytes and service arrays alone.

`app.ts` is a shared assembly point: G/D466's parked removal plan Task 3 owns
its fiscal options/error/dispatch deletion; G/D112's approved but unbuilt P3
Task 15a names account-http `src/{app,server,server-cli,config,index}.ts` and
new `country-app.ts`. Registration `src/index.ts` is also a prospective shared
export point for G/D462–D463; D466 eventually removes fiscal exports/consumers.
At inspection, `git diff --name-only main...refactor/remove-fiscal-registry`
shows only its Task 1 tests/backlog, not an implemented HTTP deletion. The
parked D79 branch currently changes its test-cloud harness, not these adapters.
These are planned overlaps, not evidence of current text conflicts.

Use a J-only adapter plus one import/option/dispatch addition; make no edits to
existing account-http `config.ts`/`index.ts` or portal `app.ts`. Before either
owner touches shared `app.ts` or registration `index.ts`, agree the exact hunks
and landing order with D466/P3/D462–D463, or wait for their landing and rebase.
If P3 lands first, mount only in its country app, never the global app, and
update J3's path/tests before starting. Recheck actual dirty files and branch
diffs rather than declaring whole files free. Lane D/D468 owns only
`packages/registration/test/worker-loop-timing.test.ts` and its backlog paragraph;
neither belongs to J. Add J-specific tests listed below. Update only J's own
billing backlog paragraph at finish and preserve every other lane's bytes.

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

### Task J1: Define truthful display periods and state

**Files:**
- Create: `packages/registration/src/billing-display.ts`.
- Modify: `packages/registration/src/index.ts` (coordinated export only).
- Test: `packages/registration/test/billing-display.test.ts`.

**Interfaces:**
- Consumes C's `VenueBillingView`, `TrialView`, `FrozenCharge`, `PaymentState`,
  `BillingPriceVersion`, B's `CivilDate`/`addDays` and the agreed wire rules.
- Produces `BillingDisplayV1`, `BillingDisplayFacts` and
  `projectBillingDisplay(facts:BillingDisplayFacts,today:CivilDate):BillingDisplayV1['billing']`.
  Facts contain the scoped venue, trials and charges; each charge contains its
  frozen charge, accepted attempts as `{state:PaymentState;succeededAt:string|null}`
  and exact `{venueId:string;on:CivilDate}[]` allocated hosted days. No raw
  observations or provider-method values. J2 constructs these facts.
  Property names are `venue`, `trials`, `charges`; each charges entry has
  `charge:FrozenCharge`, `attempts` and `hostedDays`, with the shapes just given.
  Also export `billingDisplayDay(asOf:string,timeZone:string):CivilDate` for
  deterministic country-midnight/DST tests; reject invalid instants/zones.

- [ ] **Step 1: Write the failing behavioral cases.** Assert `registered/active/null`
  for a known unstored venue; matching connected/hosted trials use stored exact
  ends, including extension, and `2026-10-31` to `2026-11-30` excludes 30 November.
  A still-active expired trial gives unavailable; a stored effective lapse gives
  lapsed. Paid connected `[2026-11-01,2026-12-01)` contains 30 November but not
  1 December. Prepaid future coverage is not selected early. Pending alone creates
  no paid period/failure; accepted failure/refund signals payment_failing without
  creating coverage. A pending retry does not clear that signal; any accepted
  success on the same charge restores coverage. Test a
  refunded first attempt followed by a different successful attempt, and raw
  failed/refunded observations that never changed accepted success.
  For hosted allocations on 1 and 3 November, reading on the 2nd returns only
  `[01,02)` with coversAsOf false, never `[01,04)`; on the 3rd return `[03,04)`
  true. Adjacent settled days may coalesce; another level/venue or unpaid day
  cannot bridge them. Include zero-cent omitted hosted lines, connected credit
  whose source was later refunded, and a paid business charge without this
  venue's line/allocation. An unresolved relevant failed/refunded charge with no
  remaining accepted success, alongside a settled different charge whose
  renewalDate is the same or later, gives unavailable. Pin same-date charges,
  same-charge recovery, earlier unrelated successes, venue scoping, and trial or
  lapse precedence. This is a conservative unknown, not a claim that recovery
  occurred. Pin lapsed historical-period selection and all null cases from the
  contract. Keep existing C history assertions unchanged.
  Name the omission targets `billing display requires remaining accepted success`
  and `billing display preserves exact hosted day holes`.
- [ ] **Step 2: Observe local RED.** Run
  `node --test packages/registration/test/billing-display.test.ts`.
  Expect the missing projector assertion, then each named rule to discriminate
  its incorrect result; record actual failure, not just an import error.
- [ ] **Step 3: Implement the interface and agreed precedence only.** Use accepted
  charge settlement and exact days; do not change C's historical semantics or
  infer transitions, future payments, service permissions or debt settlement.
- [ ] **Step 4: Observe local GREEN.** Repeat J1's command and
  `node --test packages/registration/test/billing-calendar.test.ts packages/registration/test/billing-trials.test.ts packages/registration/test/billing-charges.test.ts packages/registration/test/billing-config.test.ts`.
  Require nonzero counts, zero failures/unexpected skips, then `pnpm typecheck`.
- [ ] **Step 5: Commit with sign-off.**
  `git commit -s -m "feat: project venue billing display without inventing coverage"`.

### Task J2: Read country billing through the existing installation proof

**Files:**
- Create: `packages/registration/src/billing-display-machine.ts`.
- Modify: `packages/registration/src/installation-proof.ts` (add the action to
  both the `MachineAction` union and its runtime allowlist),
  `packages/registration/src/index.ts`
  (coordinated exports only).
- Test: `packages/registration/test/billing-display-machine.test.ts`,
  `packages/registration/test/billing-display-proof.test.ts` (pure),
  `packages/registration/test/billing-display-vector.json` (synthetic fixed vector).

**Interfaces:**
- Produces `BillingDisplayMachine(pool:Pool,issuer:LeaseIssuer,origin:string,
  options:{countryCode:'ES';calendarTimeZone:string},trusted?:ReadonlyMap<string,string>)`;
  `authenticate(envelope:unknown):Promise<MachineClaims>` for rate accounting and
  `read(envelope:unknown):Promise<BillingDisplayV1>` for final authorisation/read.
- Consumes `InstallationStore.authenticate`, `readMachineClaims`, `verifyMachine`,
  `verifyLease`, `createLeaseTrust`, `transaction`, `readBillingPrice` and J1.
  `authenticate` alone grants no billing read. Derive today from the trusted
  configured calendar and one server instant captured after lock waits.
- Produces `BillingDisplayError extends Error` with readonly code
  `'invalid_request'|'unsupported_billing_version'|'temporarily_unavailable'`;
  retain `InstallationError` for proof/revocation failures. Missing effective
  prices become a component result, not a whole-read error.

- [ ] **Step 1: Add pure signing and real DB RED cases.** The fixed vector must
  preserve existing envelope bytes/domain, sign the new action/body and reject
  one-byte changes/cross-action use. Test the country-zone date either side of
  local midnight/DST. DB fixtures use actual C commands/tables and two pools:
  another business in the same organisation, another organisation, installation
  and country schema cannot read each other's facts. Reject expired/mismatched
  leases, key/origin/environment/venue changes, revoked and superseded machines,
  and added signed selectors. Block a read behind a parent lock, commit revocation
  or a billing change on the other pool, release it and assert fresh refusal or
  one complete new billing snapshot, not mixed fields. Use observed
  `pg_stat_activity` barriers, never timing sleeps. Verify uninitialised reads
  create no business/trial/event/operation/contact rows or updates. Missing schema
  is a 503-bound failure. Test missing/future/effective prices and a later price
  publication without changing frozen charges. Exercise J1's sparse/zero-line
  allocations and refunded-first/later-success cases through actual stored facts.
  Name the scope and queued-refusal targets `billing display derives venue business scope`
  and `billing display rechecks revocation after waiting`. Add
  `billing display refuses unsafe account origins` against the machine constructor
  as well as HTTP config, so deleting its secure-origin check is observable.
- [ ] **Step 2: Observe RED before implementation.** Locally run
  `node --test packages/registration/test/billing-display-proof.test.ts`.
  **CI:** `pnpm --dir packages/registration exec node --test --test-timeout=30000 test/billing-display-machine.test.ts`.
  Sign off/push tests first; record named assertion, exact SHA and actual package
  job. Missing action/read is expected; DB setup failure is not.
- [ ] **Step 3: Implement one scoped transaction.** Use preliminary routing only
  to locate a stored key, then verify. Follow C's parent order: organisation
  SHARE, legal business NO KEY UPDATE, billing business SHARE if present; then
  lock the stored venue and installation SHARE and recheck the derived mapping,
  key, revocation/supersession and lease with fresh time after waits. Parent
  locks serialize C writes even when billing children do not exist. No external
  awaits or nested `BillingStore` transactions. Read venue/trials, venue-scoped
  charge lines, exact consumed days and all accepted attempts in this transaction;
  read the effective price once. Build minimal J1 facts, not `history().paid`
  bounds or a business-wide payment summary. Validate configured country/calendar
  and use `origin + '/account'`; return only the agreed wire fields.
- [ ] **Step 4: Observe GREEN.** Repeat both J2 commands, plus **CI**
  `pnpm --dir packages/registration exec node --test --test-timeout=30000 test/billing-payments.test.ts test/billing-venues.test.ts test/installations.test.ts`.
  Require all original assertions, nonzero counts and no unexpected skips;
  locally run J1/proof pure files and `pnpm typecheck`.
- [ ] **Step 5: Commit with sign-off.**
  `git commit -s -m "feat: read country billing with installation authority"`.

### Task J3: Mount the bounded display adapter without changing configuration

**Files:**
- Create: `packages/account-http/src/billing-display.ts`.
- Modify: `packages/account-http/src/app.ts` (coordinated additive route/option).
- Test: `packages/account-http/test/billing-display.test.ts`,
  `packages/account-http/test/billing-display-socket.test.ts`.

**Interfaces:**
- Produces `BillingDisplayOptions={countryCode:'ES';calendarTimeZone:string}` and
  `billingDisplayResponse(c:Context,options:{machine?:BillingDisplayMachine;
  ip:string;consume:(rules:RateRule[])=>Promise<void>}):Promise<Response>`.
- Add `billingDisplay?:BillingDisplayOptions` to `createAccountApp` options.
  Construct the machine only when options and existing issuer are configured;
  otherwise this exact route returns 503. Do not add environment/deployment
  enablement. P3's later country composition must supply the country binding.
  No new public export, general configuration rewrite or portal route is needed.

- [ ] **Step 1: Write real HTTP/socket RED cases.** Authenticated POST returns
  the exact bound v1 shape; GET is 405; browser Origin/wrong host 403; invalid
  body/query/media/size/time uses the agreed errors. Unknown/crossed proof or
  lease is 401; revoked/superseded is 403; missing options/issuer/DB is 503.
  Distinguish unsupported version from invalid signed body. Assert 200 partial
  price/state unavailability, no secrets/cookies, no-store on success/errors,
  response <=16,384 UTF-8 bytes and no ETag/304 behavior. Verify shared 60/IP and
  30/installation budgets across app workers, existing general budget and
  Retry-After. Read through a real socket, restart only the owned server, change
  facts and repeat the operation UUID: return current facts, no stored result.
  Original `{}` and servicesVersion 2 configuration responses/arrays stay equal
  before/after this addition, including test-free-paid mode. Display still works
  for registered/lapsed/unconfigured venues. Account URL is exactly trusted
  `/account`, no selectors/token/query/fragment; unsafe origins refuse before
  reads. Confirm `/account` exists without claiming F's controls exist.
- [ ] **Step 2: Observe database-backed RED in actual CI.**
  `pnpm --dir packages/account-http exec node --test --test-timeout=30000 test/billing-display.test.ts test/billing-display-socket.test.ts`.
  Expect missing route/incorrect response assertions. Commit tests with sign-off
  and read the actual failing account-http job before implementing the adapter.
- [ ] **Step 3: Implement the exact-path adapter.** Reuse `readAccountBody`,
  current host/query/security handling and machine rate scopes; map new display
  errors inside this adapter, retaining existing installation error mapping.
  Apply the proposal's five-second/16 KiB request bounds, eight-second/16 KiB
  client agreement, no-store and explicit partial-result semantics. Keep the
  endpoint independent of service/placement readiness and paid enforcement.
- [ ] **Step 4: Observe GREEN in CI.** Repeat J3's command and
  `pnpm --dir packages/account-http exec node --test --test-timeout=30000 test/installations.test.ts test/account-http.test.ts test/rate-limit.test.ts`.
  Require actual test counts and unchanged assertions. Locally run J1/J2 pure
  tests and `pnpm typecheck`; do not run the database wrapper.
- [ ] **Step 5: Commit with sign-off.**
  `git commit -s -m "feat: serve the installation billing display contract"`.

### Task J4: Qualify guards and the exact consumer boundary

**Files:**
- Create: `scripts/billing-display-guard-probes.mjs` (native disposable-copy
  runner, `--pure` or `--database`),
  `scripts/billing-display-guard-probes.test.mjs` (pure harness controls),
  `packages/account-http/test/billing-display-guards.test.ts` (CI DB wrapper).
- Modify: `docs/waitron-integration-contract.md` (accepted vectors/consumer pins),
  `docs/backlog.md` (J paragraph only). No Waitron edits in the Cloud checkout.

**Interfaces:** The runner executes the actual named J1/J2/J3 tests in complete
disposable candidate copies with dependencies, never edits the feature tree,
inherits CI's disposable TEST_DATABASE_URL only in database mode, and emits
fixed test/guard/count results without credentials. The package wrapper runs
`billing-display-guard-probes.test.mjs`, then both `--pure` and `--database`.
Use explicit bounded timeouts following C's omission-test pattern and set the
wrapper test's own timeout to 240,000 ms to override CI's 30-second default.
All five omissions and the harness controls must execute in that package job;
the generic root glob does not discover this harness filename.

- [ ] **Step 1: Write harness RED controls.** A missing/ambiguous mutation target,
  skipped case, setup error, timeout or zero-case run must fail qualification.
  Use a behavioral negative control that leaves a bad guard undetected and
  requires rejection. Run `node --test scripts/billing-display-guard-probes.test.mjs`
  and observe its specific failure before implementing the runner.
- [ ] **Step 2: Implement native deletion probes.** For each guard, require an
  unchanged passing baseline, remove exactly that guard, observe its named
  assertion fail, restore the bytes and require it pass again. Pure mode omits
  accepted-success filtering, then exact-day gap separation. Database mode omits
  derived venue/business scoping, final revocation check after waiting,
  then account URL validation. Exercise real DB/socket paths for those guards;
  failures in setup/imports or textual checks earn no detection. Preserve the
  old assertions and only delete guards in owned disposable copies. Clean only
  recorded owned files/processes. No Docker startup in this runner.
- [ ] **Step 3: Observe GREEN and retain receipts.** Locally:
  `node --test scripts/billing-display-guard-probes.test.mjs` and
  `node scripts/billing-display-guard-probes.mjs --pure`, plus J1/J2 pure files.
  **CI:** `pnpm --dir packages/account-http exec node --test --test-timeout=240000 test/billing-display-guards.test.ts`;
  require passing harness controls plus two pure and three database detected
  omissions and restored controls, not a summary
  without executed cases. CI must discover the wrapper through its existing
  `test/*.test.ts` glob. If the relevant package shard omits it, stop readiness.
- [ ] **Step 4: Verify the shared handoff.** Give Lane B the accepted synthetic
  vector and success/partial/error examples. Lane B owns Waitron's client,
  manager-protected local API and dashboard tests: exact response binding,
  bounded redirect-refusing fetch, request-generation fencing, correct civil
  end/VAT/daily-basis labels, unavailable clearing, safe account link and proof
  that every billing/error state leaves sale/service behavior unchanged. Its
  current `cloud-installation.ts` parser drops unknown fields, so configuration
  enrichment alone cannot deliver A1185. Record real consumer pins/results when
  supplied; until then report Cloud provider qualification only, not A1185 done.
- [ ] **Step 5: Commit and finish through RUNNER.**
  `git commit -s -m "test: qualify billing display guards and shared boundary"`.
  Announce readiness for `finish-branch`; the driver runs its one Claude run-it
  whole-branch review after initial rebase in a complete throwaway checkout with
  dependencies, triages findings, uses normal hooks and requalifies any changed
  head. Require every selected job final on the exact PR SHA in CI and the
  cloud-cost workflow: inspect changes/selection, documentation/scripts, all
  four root shards, typecheck, selected package shards including registration
  and account-http, receipts and strict summary. Audit any justified skip/reuse;
  a green summary alone is insufficient. Do not repeat the full external review
  only for a rebase. Under the driver's own shared landing lock, recheck current
  main is an ancestor of that qualified head, then land normally. Verify the
  independent main runs name the exact merge SHA and every job is final with
  the same applicable evidence. No live enablement follows from landing J.

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
no cascading delete. Forbid identity changes, deletion and revision rewind with
`55000`; updates advance exactly one generation. Row existence means this venue has explicitly entered D's
transition path; revision is a durable generation that makes old writers invalid.
It stores no second level, price, payment or expiry policy. No backfill or default
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
changes the grant's time limit. Same facts under another event and exact replay
advance it zero times. C's billing venue revision still follows C's existing
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

### Consumer map and lock order

Every row below either consumes the new authority in new mode or preserves a
named independent gate. Paths are repository-relative; brace lists name actual
files. Repeat `rg -n 'readVenuePlan|readOrganisationPlan|requirePlanService|planAllows|service_plan|test-free-paid|PlanMode' packages deploy scripts docs`
before editing; classify new matches, including SQL predicates and runtime branches.
Do not replace only the exported helper and leave direct SQL behind.

| Owner / current entry points | D change or retained boundary |
| --- | --- |
| Registration `src/organisation-plans.ts`, exports and `RegistrationStore.complete` in `src/index.ts`; `src/{pairing,organisation-plan-cli}.ts` | Preserve legacy exports; add new reader/transition exports. Pairing/replacement serialize creation against the venue authority before installations; no plan in registration result. CLI remains guarded legacy-only. |
| Registration `src/{billing-store,billing-venues,billing-types}.ts` | `execute`, `applyVenueCommand`, `readBillingVenue`, `readVenueHistory` retain scoped recording/history contracts. Add `transition` and shared mutation hook; all four permission commands take the venue lock even if unenrolled. No changes to charge/payment meaning. |
| Registration `src/installations.ts` | `InstallationStore.execute/configure/listWithSession`, `installationPlan`, `maskPlan`: current authority on fresh **and cached** renew/configuration/report/configure/list; mask translation too at level 1 in new mode, without deleting its stored entry. Account configurations stay `{}`. Keep revoke and lease renewal possible. |
| Backups `src/catalogue.ts` | `backupPlan`, `active`, `provision`, `rotate`, `reserveCapture`, `publish`, `cleanupOne`, `cleanupCapture`, `verifyClaim`: enforce the correct stream/snapshot floor; repeat admission after object waits. Keep keys/objects/holds; already admitted verification and abandoned staging cleanup can finish. Level-1 retained expiry pauses in this bounded test mode only. |
| Backups `src/{managed-streams,captures}.ts`; account-http `src/{captures,managed-streams,backups}.ts` | `ManagedStreams.configure/observe/recovery`, `BackupCaptures.execute`, `ManagedStreamMachines.execute`: auth first; current authority and generation before/after provision/read/grant. Generalise explicit reprovisioning branches currently testing only `test-free-paid`; preserve input/revision conflicts and fresh writer requirement. |
| Backups `src/{recovery,recovery-request,replacement}.ts`; account-http `src/{recovery,replacement}.ts` | `BackupRecovery.start/target/catalogue/status/close`, `RecoveryRequests.inspect/approve`, `ReplacementStore.machine/inspect/complete`: metadata/status/close remain available at level 1; new key/data grants and replacement activation refuse. HTTP read rechecks after STS/reader wait. Keep v2 target qualification, fresh target, declaration, owner/session and operation expiry checks. |
| Direct storage `deploy/test-cloud/{service-runtime,storage-authority,storage-worker,storage-issuer}.mjs`; backups `src/storage.ts` | `openPlanStorage`, `openRuntimeStorage`, `testStorageOptions`, `openStorageAuthority({authorizeWriter})`: new-mode writer `policyRevision` is the per-venue authority generation, not organisation revision. Keep numeric generations and Cloud recovery reader; version private state as described in D3. Compare generation/permission after waits and on restart/reconcile; no new customer reader at level 1. Legacy writer revision semantics remain unchanged. STS still requests 900 seconds and rejects >901-second returned lifetime. |
| Remote `src/{plan-permissions,placement}.ts` | `requireRemotePlan(client,id,mode,setup=true)`, `eligibleRemoteInstallations(client,mode,cellId?)`; `RemoteAccessStore.provision/stageMove/markMoveReady/completeMove/setHostname/hostnameInstructions/authorizeCertificate/publishAuthorizedCertificate/manifest/publishManifest/reportingManifest/publishReportingManifest`: authority before installation/cell locks, both active and incoming staged routes. Keep `cancelMove` available as withdrawal. |
| Remote `src/{staff-exchange,reconciler,forward-observations}.ts`; account-http `src/{staff-certificates,remote-access}.ts` | `StaffCertificateExchange.execute`, `RemoteConfigurationReconciler.schedule/runOnce`, `ForwardObservationStore.record/readCurrent/prune`, account status/DNS: replace direct `o.service_plan` predicates as well as helpers with the same locked eligible set. Current `desiredTargets` and `#reportingManifest` have extra SQL bypasses. Publication/desired digest/observations must agree; denied reads expose no certificate/current forward claim. |
| Registration `src/{relay-grants,relay-messages,relay-worker}.ts`; account-http `src/relay-messages.ts` | Email stays basic at all levels. Pass mode to `RelayGrantStore`/`RelayMessages`/`RelayWorker` and read basic eligibility in `authority` before venue/installation locks, including approve after origin verification and reserve/handoff. Preserve message-identity advisory lock, account allowance, consent/origin/grant revision, cancellation, deduplication and operator stop. Account signup/reset `EmailOutbox` is independent of venue billing. |
| Translation `src/{machine,job-store,worker,batch-runner,consent,retention,worker-cli}.ts`; account-http `src/{app,translation,translation-consent}.ts` | `TranslationMachine.execute`: authenticated bound submit replay first, then level-2 check for a **new** job before consent/readiness/spend admission. Keep owned status/collect/release and replay after downgrade or lost consent/readiness; no new provider work from replay. Gate existing worker's `mayCall` before each first/review/retry call and after waits. Preserve cost/lease callbacks, consent, paging, result retention and ownership-first cursor checks. No billing worker or new provider adapter. |
| Address `docs/address-lookup-scope.md`; `deploy/test-cloud/free-services-mail.test.mjs` | No shipped address HTTP/store entry exists in inspected `packages`/`deploy`; `/v1/address-lookup/*` is deliberately unavailable. Pure floor is level 1; preserve missing-route/provider-off assertions and discarded API-key env. Do not invent an address API. Rota/hosting likewise get pure permission floors only. |
| Composition account-http `src/{app,server,server-cli}.ts`; backups `src/worker-cli.ts`; remote `src/{operator-cli,reconciler-cli}.ts`; translation `src/worker-cli.ts` | Extend validated mode threading to all constructors; no helper reads ambient env. Existing `PlanMode` parameters/defaults stay source-compatible; new translation/relay options append rather than shifting arguments. Preserve disabled-service responses. |
| `deploy/local-stack/runtime.mjs`; `deploy/test-cloud/{runtime,account-worker,backup-worker,remote-worker,remote-runtime,service-runtime,storage-worker}.mjs`, `compose.yaml`, `test.env`; `scripts/test-cloud-free-services.mjs` and `deploy/test-cloud/test-fixtures/{storage-client,remote-client,snapshot-client}.mjs` | Thread the new flag consistently, keep both defaults `0`, unchanged old proof modes/results, local stack dormant and provider inputs dropped. Add a separate venue-level proof mode/fixture rather than relabel legacy receipts. D79 integration-owned files wait for the bounded coordination above. |
| Backup maintenance `packages/backups/src/{worker,key-operations,key-operations-cli}.ts`; remote `src/{probe-targets,probe-observations,probe-cli}.ts` | `BackupWorker.schedule/runOnce` delegates expiry/verification to its mode-bound catalogue; `inspectManagedKeyDependencies` keeps recovery dependencies without exporting keys. Probes measure existing configured routes, not authority: retained observations cannot override current permission/revision filtering. No new probe grant or key retirement at downgrade. |
| Existing proof clients `scripts/{test-local-backups,test-local-remote,test-waitron-pairing,test-waitron-translation,backup-transfer-receipt,remote-reconciler-receipt,control-plane-outage-receipt,schema-upgrade-backup-fixture,schema-upgrade-relay-fixture,backup-storage-fixture}.mjs` | Their default `existing` constructors and recorded values stay unchanged. The last fixture's nonexpiring managed writer is not valid new-mode withdrawal proof. Use the mode-bound D storage adapter for that proof; do not silently reuse this bypass. |
| Tests/docs | Keep legacy `organisation-plans`, `organisation-plan-cli`, backup/remote `plan-permissions`, translation `free-service-plans`, free-services-mail/relay and runtime tests. Add D files below. Update `packages/registration/README.md`, `docs/{test-cloud,local-backups}.md` and translation backlog guide only for new mode/authority/limitations; no campaign instructions or Slice J contract edits. |

Current locks are not one simple list. Preserve these prefixes and add the venue
permission lock at the stated position:

1. Pairing/connection request locks precede account/session/membership checks in
   `pairing.ts` and `RegistrationStore.#request`. Recovery request `FOR UPDATE`
   precedes those checks in `RecoveryRequests.#browser`, `BackupRecovery.start`
   and `ReplacementStore.#locked/machine`. Keep that request-first order;
   transitions never acquire request locks. Relay message advisory identity lock
   precedes account/credentials/membership in `RelayMessages.execute` and
   `RelayWorker.#handoff`; transitions never acquire it.
2. Authenticate machine proof against the stored key before policy lookup. For
   human authority, resolve session/account/credentials/membership first and
   revalidate after waits. Then organisation `FOR SHARE` (legacy setter uses
   `FOR NO KEY UPDATE`). Billing writers next lock legal business
   `FOR NO KEY UPDATE`, billing business `FOR NO KEY UPDATE`, event advisory
   identity as C does. Service readers need none of those business locks.
3. Lock venues in UUID order: permission reads `FOR SHARE`, transitions
   `FOR NO KEY UPDATE` immediately, never SHARE then upgrade. This existing
   identity row protects even missing billing/authority child rows. Billing
   facts cannot change between reading authority and granting service. Then
   authority row, affected installations in UUID order with the required
   SHARE/UPDATE strength, and service locks. Batch exports lock **all** relevant
   organisations, then **all** relevant venues before any installation. Limit
   candidates to the captured set; first placements/incoming moves outside it
   wait for the next export. Recheck original org/business/venue/installation,
   key, environment, supersession/revocation and current time under locks.
4. Backup catalogue/streams currently take policy then installation then location;
   recovery snapshot takes verification-policy lock then location; replacement
   currently takes policy, verification-policy, venue NO KEY UPDATE, old installation,
   location, replacement, placement/cell. Move its new venue authority lock ahead
   of verification-policy without reversing request/account prefixes. Pairing
   currently takes venue NO KEY UPDATE before installation but no org policy:
   add the org lock before that venue lock, also on completed-result replay.
   `PairingStore.available` currently locks a completed installation early:
   defer that lock in paths that later read policy; take it only after org/venue
   locks and repeat its availability check. Status-only paths that never acquire
   later policy may retain their existing installation-only check.
   Remote publication takes policies/installation then cell; move/export/report
   code must insert venue locks before installation. Forward reports then take
   cell, reporter, observation. Pruning takes observations only and must acquire
   no policy locks afterwards; use eligibility computed beforehand or leave
   denied observations to expire, never authorise reads from pruning's SQL.
5. Translation currently takes installation SHARE before its `translation-venue:`
   advisory lock. Resolve/authenticate nonlocking first, then org/venue policy,
   installation, translation advisory, job. Worker lease selection must not hold
   a job lock while later acquiring venue policy: select a candidate nonlocking,
   then policy, then reselect/lock that exact still-eligible job with SKIP LOCKED.
   Relay `authority` currently takes account/membership, venue SHARE, installation
   SHARE; insert org/venue permission there, before installation/grant/allowance.

Do not hold a new authority transaction across provider/DNS/model waits. The
existing certificate/manifest publication and retention deletion callbacks hold
locks across their bounded publication/removal; keep that exclusion, so a
committed downgrade cannot precede an old publication/deletion. Other external
operations use capture, release, wait, relock and compare both permission and
generation. Refresh proof/session/lease/operation/target checks too. A free/paid
round trip during the wait must refuse the old result even if current level is 2.
Report committed downgrade separately from measured route/writer withdrawal.

### Task D1: Define the level and trial rules without a database

**Files:** Create `packages/registration/src/venue-service-rules.ts` and
`packages/registration/test/venue-service-rules.test.ts`.

**Interfaces:** Reuse `BillingLevel`, `TrialView`, `CivilDate`.
Produce `VenueService = PlanService|'rota_solver'|'hosting'`,
`levelAllows(level:BillingLevel,service:VenueService):boolean` and
`effectiveVenueLevel(base:BillingLevel,trials:readonly TrialView[],today:CivilDate):BillingLevel`.
These are new interfaces, not claimed existing exports. Reject malformed facts/
dates with `invalid_billing_input`; unknown level/service never allows access.

- [ ] **Step 1: Add named pure RED cases.** `venue levels have exact service floors`:
  in order `address_lookup`, `transactional_email`, `content_translation`,
  `continuous_backup`, `retained_snapshots`, `remote_access`, `rota_solver`, `hosting`,
  assert registered `[true,true,false,false,false,false,false,false]`, connected
  `[true,true,true,true,true,true,true,false]`, hosted eight `true` values.
  `trial dates grant only the stored half open interval`: registered plus active
  connected `[2026-10-31,2026-11-30)` gives registered on 30 October, connected on
  31 October/29 November, registered on 30 November. Stored extension to
  `2026-12-30` gives connected on 29 December and registered on 30 December.
  Lapsed/converted trials add nothing; hosted base never falls to connected;
  connected base plus expired hosted trial gives connected. Overlapping active
  trials choose hosted; neither trial record is rewritten. No method/payment/
  scheduled/display input participates. Unknown service/level returns false;
  malformed trial state, inverted/impossible dates or invalid today raises
  invalid_billing_input before any positive permission.
- [ ] **Step 2: Run `node --test packages/registration/test/venue-service-rules.test.ts`
  and record actual named RED before implementation.** Use runtime export
  assertions initially; then observe the behavioral floor/boundary failures, not
  just a missing static import. No PostgreSQL setup in this file.
- [ ] **Step 3: Implement only these pure rules.** Keep allowance policy out.
- [ ] **Step 4: Repeat D1's command; require nonzero tests, zero failures/skips.**
- [ ] **Step 5: Commit `git commit -s -m "feat: define venue service level permission rules"`.**

### Task D2: Make permission changes atomic with C's events and setup

**Files:** Create registration `src/venue-service-permissions.ts`,
`test/venue-service-permissions.test.ts`, `test/venue-service-migration.test.ts`;
modify `src/{organisation-plans,billing-store,billing-venues,billing-types,index,migrate}.ts`
and `test/fixtures/migration-release.ts` (add pinned 45 release only).
Make D6's explicitly specified current-tail test replacements and historical-v6
wrapper invocation change in D2's test-only commit, before adding the migration;
otherwise the installed v6 HEAD assertion prevents D2's CI from reaching GREEN.
D6 owns the new v7 proof, not postponing those compatibility prerequisites.
Add one new migration, provisionally `046_venue_service_authority.sql`, only after
slot reconciliation with P3/parked work. Never change landed 001–045 SQL.

**Interfaces:** Produce `VenuePermission = BillingScope & {venueId:string;
level:BillingLevel;revision:number}`, `PermissionCommand = Extract<BillingCommand,
{type:'set_venue'|'start_trial'|'extend_trial'|'end_trial'}>`,
`readVenuePermissions(client:PoolClient,venueId:string,mode:'test-venue-levels',lock?:'SHARE'|'NO KEY UPDATE'):Promise<VenuePermission>`,
`requireVenueService(client:PoolClient,venueId:string,service:VenueService,mode:PlanMode,lock?:'SHARE'|'NO KEY UPDATE'):Promise<void>`;
add `BillingStore.transition(scope:BillingScope,event:BillingEvent,command:PermissionCommand):Promise<BillingReceipt>`.
An internal `applyPermissionTransition(context:BillingContext,command:PermissionCommand,
enrol:boolean):Promise<BillingValue>` wraps `applyVenueCommand` on the same client.
`readVenuePermissions` is the only new-mode authority, including batch consumers;
`requireVenueService` branches explicitly: existing returns without new reads,
legacy uses `readVenuePlan`/`planAllows`, new mode uses the new reader/rules.
Lock defaults to SHARE; replacement requests NO KEY UPDATE at its first policy
read because it later mutates the venue. Legacy mode refuses enrolled venues;
do not project free translation through the
new level-1 matrix. Permission refusal is `Error('permission_denied')`, mapped through existing typed
machine/backup/account errors. Add `test-venue-levels` to `PlanMode` and extend
`parsePlanMode(legacy:string|undefined,venueLevels?:string):PlanMode` with the
compatibility table. Keep pure rules out of the `pg` module for native tests.

- [ ] **Step 1: Add DB RED cases with real C facts, installations and two pools.**
  `recording cannot activate an unenrolled venue`: C set connected yields billing
  revision 1 but permission registered/revision 0, unchanged three setup rows.
  `transition enrols once and raw setters cannot bypass it`: enrol with a fresh
  same-value set event yields authority revision 1, each installation +1; exact
  replay returns identical receipt, +0. Raw `execute` downgrade advances authority
  to 2 and clears all three rows to unconfigured/`{}`. A subsequent upgrade is 3,
  clears nothing further and restores no setup; no-op facts +0. Trial extension
  advances generation once even while effective level stays 2.
  `same organisation venues never share permission`: A connected, B registered,
  C hosted, including a second legal business; downgrade A changes only A's
  installations, B/C revisions and grants stay byte-identical. Legacy org toggle
  must leave enrolled A/B/C setup unchanged.
  `permission transaction rollback preserves facts event and setup`: inject an
  owned trigger failure after setup change, compare all rows/events/generations,
  remove trigger and retry once. Foreign/unknown scope refuses with zero effects.
  `permission locks precede installations even for absent rows`: hold venue lock,
  observe waiter in `pg_stat_activity`, assert a third connection can still lock
  installation; reverse-order run must fail that assertion, not earn a timeout.
  Race transition with pairing, replacement and two-installation reads; bounded
  completion, no deadlock, and no new installation escapes current permission.
- [ ] **Step 2: Sign off the test-only commit and observe each intended named RED
  in actual registration CI before adding SQL/implementation.** A missing new
  relation/export is initial RED; setup errors, skips and unrelated failures are
  not guard evidence. Use runtime imports so typecheck does not stop execution.
  **CI:** `pnpm --dir packages/registration exec node --test --test-timeout=30000 test/venue-service-permissions.test.ts test/venue-service-migration.test.ts`.
- [ ] **Step 3: Implement D2's interfaces and lock order.** Validate inputs before
  mutation; use C's event advisory/receipt path, protect empty authority rows with
  the parent venue lock. Legacy setters exclude enrolled venues. Never infer
  enrolment on a read. Preserve C's original unenrolled/no-enforcement assertions.
- [ ] **Step 4: Observe D2 GREEN in CI; locally run D1 and `pnpm typecheck`.**
  Re-run C's billing-store/venues/payments/schema tests in CI, not locally.
- [ ] **Step 5: Commit `git commit -s -m "feat: transition enrolled venue permissions with billing events"`.**

### Task D3: Fence installation replies, backups, recovery and direct storage

**Files:** Modify the registration installation, backup, account backup/recovery,
composition and storage paths named in the consumer table. Create
`packages/registration/test/venue-service-installations.test.ts`,
`packages/backups/test/venue-service-backups.test.ts`,
`packages/account-http/test/venue-service-recovery.test.ts`,
`deploy/test-cloud/venue-service-storage.test.mjs`.

**Interfaces:** Preserve `InstallationStore` and backup method signatures from
the table; consume D2 on their supplied `PoolClient`. `openPlanStorage` keeps its
existing `{pool,mode,...options}` contract and numeric `policyRevision`; new-mode
revision comes from `VenuePermission.revision`. Preserve `ManagedStreamAuthority`
`provision/reader/read/withdrawWriter/reconcile` contracts. No new Waitron wire. Extend `openStorageAuthority` options with
`policyMode?:PlanMode` and its authorizer callback with an optional third
`policyMode` argument. In explicit new mode upgrade private state to version 2,
adding each writer's mode; absent/v1 mode is legacy, never new-mode authority.
Under the existing file lease retire mismatched writers before publication,
preserve the original reader/retired keys and atomically persist the new mode.
New writer eligibility requires both mode and revision equality. Legacy v1
fixtures remain v1; old binaries must refuse v2 rather than ignore its mode.
No state-format change reaches Waitron's wire.

- [ ] **Step 1: Add named RED assertions.** `venue cached replies cannot reissue
  cleared setup`: for fresh/replayed renew, configuration v1/v2, report, configure
  and account list, level 1 has all paid entries `state=unconfigured`, `configuration={}`, `health=unknown`,
  `failure=null`, `observedAt=null`; v2 translation is masked too, stored entry unchanged.
  Valid renew still issues the existing 3,600,000 ms lease. Old report revision
  refuses conflict; forged signatures remain invalid_proof, not permission_denied.
  `venue backup downgrade preserves recovery without new grants`: reserve, publish,
  rotate, stream configure/observe, recovery approve/target read and replacement
  complete refuse permission_denied at 1 with grant calls 0, key versions/object
  counts unchanged. Catalogue/status/close still succeed for the owner; foreign
  owner and stale target/v2 qualification still refuse their original errors.
  `venue external wait rejects a round trip`: block grant/object/stream provider,
  transition 2→1→2, release; no credentials/key/new point/observation/replacement
  escapes and no partial setup commits. Repeat with revocation, lost membership,
  session/lease/operation expiry and replacement binding change.
  `venue explicit reprovision keeps keys and replaces the writer`: upgrade alone
  keeps setup empty; explicit same location/placement reprovision works once,
  stream current revision succeeds, original keys/reader/data survive, old writer
  credentials fail at storage and new writer succeeds. Same-org neighbour works.
  `writer modes cannot collide at equal revision`: legacy revision 1 then enrolled
  venue generation 1 retires the old writer and returns a distinct key/reference;
  old key receives storage 403, recovery reader/key/data unchanged. Restart with
  v2 state retains mode/generation; a legacy-mode reopen cannot authorise the new
  writer through an equal org revision. Missing/invalid mode/state refuses.
  `venue level one pauses expiry but not abandoned staging cleanup`: retained
  deletion count 0 even after elapsed retention; staging cleanup removes only
  expired unpublished objects. Last verified point and active recovery holds stay.
  A deletion already holding authority completes before downgrade commits.
- [ ] **Step 2: Observe actual named RED before modifying each boundary.**
  **CI:** `pnpm --dir packages/registration exec node --test --test-timeout=30000 test/venue-service-installations.test.ts`;
  `pnpm --dir packages/backups exec node --test --test-timeout=30000 test/venue-service-backups.test.ts`;
  `pnpm --dir packages/account-http exec node --test --test-timeout=30000 test/venue-service-recovery.test.ts`.
  The new backup file uses DB/object doubles for waits, no Docker-building global
  hook from old `plan-permissions.test.ts`. Storage uses real existing fixture in
  CI: `node --test --test-timeout=120000 deploy/test-cloud/venue-service-storage.test.mjs`;
  invoke that file from D6's discovered package wrapper so it cannot be omitted.
- [ ] **Step 3: Implement the named consumers and post-wait generation checks.**
  Generalise D79's existing cleared-setup reprovision branches. Preserve Cloud's
  reader on writer withdrawal; no new customer read grants at 1. DB failure must
  withdraw before reconciliation error, and restart must finish pending intent.
  Prove actual storage refusal; API refusal is not writer revocation. Do not claim
  immediate removal of already issued STS: measure its existing expiry bound.
- [ ] **Step 4: Require D3 GREEN and unchanged legacy backup/recovery assertions
  in CI; locally D1 and typecheck only.** No customer cancellation/deletion clock
  is introduced; the 90-day readable exit remains §8's separate implementation.
- [ ] **Step 5: Commit `git commit -s -m "feat: enforce venue permissions across backup and recovery boundaries"`.**

### Task D4: Use the same eligible venue set for remote work

**Files:** Modify remote and account remote paths in the table; create
`packages/remote-access/test/venue-service-remote.test.ts` and
`packages/account-http/test/venue-service-remote.test.ts`.

**Interfaces:** Preserve remote public signatures; `eligibleRemoteInstallations`
uses D2 reads after sorted batch locks. Its `existing` result remains `undefined`;
new mode returns exact eligible installation UUIDs, including `[]`. Scheduling,
active/staged manifests, publication and observations consume that same set.

- [ ] **Step 1: Add `venue remote routes isolate same organisation siblings`:
  A at 2 and B at 1 in one organisation yields active/staged installation IDs
  exactly `[A]` in their respective source/target cells, never B. After A drops
  to 1 both lists are `[]`, peer count 0, pending certificate work disabled;
  after upgrade they remain `[]` until explicit reprovision. Include forward
  reports both on/off. `venue remote publication rechecks after waits`: paused
  DNS/signing/certificate work followed by downgrade or 2→1→2 never publishes
  old artifacts or completes the old job. Signed authority lifetime stays
  <=600,000 ms and gateway restart cannot extend it. Status/certificate reads
  refuse or mask using current permission even before schedule catches up.
  Retain foreign owner, forged proof, expected revision, incoming-move race,
  current reporter and unrelated-cell nonblocking assertions.
- [ ] **Step 2: Observe named DB RED in actual CI.**
  `pnpm --dir packages/remote-access exec node --test --test-timeout=30000 test/venue-service-remote.test.ts`;
  `pnpm --dir packages/account-http exec node --test --test-timeout=30000 test/venue-service-remote.test.ts`.
- [ ] **Step 3: Replace every direct paid SQL filter listed in the table, not the
  legacy stored field's meaning.** Add venue locks ahead of installation locks;
  keep publication exclusion and original-binding rechecks. Pruning cannot
  become an alternate permission authority.
- [ ] **Step 4: Require D4 GREEN plus original plan-permissions, manifest-route-reads,
  reconciler-route-reads and forward-observations checks in CI.** Locally D1/types.
- [ ] **Step 5: Commit `git commit -s -m "feat: filter remote work through current venue permissions"`.**

### Task D5: Move new translation work to level 2 and keep basic services basic

**Files:** Modify translation, relay, composition/CLI/runtime paths in the table;
create `packages/translation/test/venue-service-translation.test.ts`,
`packages/registration/test/venue-service-relay.test.ts` and
`deploy/test-cloud/venue-service-runtime.test.mjs`. Add a separate new-mode proof
in `scripts/test-cloud-free-services.mjs` with its verifier tests; do not change
legacy receipt expected fields or values.

**Interfaces:** Append `planMode:PlanMode='existing'` after TranslationMachine's
current `collectPageBytes` argument; add `planMode?:PlanMode` to TranslationWorker's
existing options. Append mode to RelayGrantStore/RelayMessages/RelayWorker
constructors as `RelayGrantStore(pool:Pool,config?:RelayConfig,planMode?:PlanMode)`,
`RelayMessages(pool:Pool,issuer:LeaseIssuer,origin:string,config:RelayAdmissionConfig,
trusted?:ReadonlyMap<string,string>,planMode?:PlanMode)` and
`RelayWorker(pool:Pool,config?:RelayWorkerConfig,planMode?:PlanMode)`, with
`existing` defaults. Pass mode from account app
and worker CLIs. Extend existing `BatchHooks` with optional
`stillPermitted?():Promise<boolean>`: after each provider wait/callback accounting,
stop further review/retry work on denial. Keep consent/spending checks independent.
Current in-flight spend is recorded once, never replayed because a guard/storage
callback failed. Previously admitted outputs may be saved and collected, but that
completion authorises no new model call. On lost permission, persist a valid
first-pass result and skip review (done, reviewApplied/reviewDropped both 0);
a failed response gets no retry and terminates with existing
`state=failed,reason=provider_unavailable,failed=total`. A queued denied job likewise
terminates unavailable with zero provider calls, so it cannot starve a paid
neighbour. Keep already saved results and use existing partly_done semantics
where only some batches completed; never invent a new wire reason. Do not change
archived prompts or prices.

Add `--venue-levels` to `scripts/test-cloud-free-services.mjs` and
`validateVenueServiceReceipt(value:unknown):true`, keeping its existing mode and
validator untouched. New receipt has exactly `version:2`,
`kind:'test-cloud-venue-services'`, `cloudHead`, `cloudTree`,
`scope:'local-fixtures'`, `mode:'test-venue-levels'`,
`productionEnforcement:'off'`, `suites`. Reuse the existing per-suite count shape;
require exact suite IDs `rules`, `installations`, `backups`, `recovery`, `remote`,
`translation`, `relay`, `runtime`, `storage`, each with tests>0, passed=tests and
failed/cancelled/skipped/todo all 0. Pins must match the clean candidate.
D6's CI wrapper runs this mode explicitly; it is a Cloud fixture receipt,
not joint Waitron/provider qualification.

- [ ] **Step 1: Add `registered venue refuses new translation before provider use`:
  valid consent/readiness at 1, and a forged body selector naming paid sibling,
  both yield machine 403 permission_denied, jobs +0, fake provider calls 0.
  At 2 and 3 submit queues once and normal paging succeeds; lack of consent still
  gives consent_required. `translation durable results survive venue downgrade`:
  complete the existing Cafe fixture, downgrade, remove consent/readiness; replay
  returns the same jobId, status done, results exactly
  `[{ref:'product:1',names:{ca:'Cafe [ca]',es:'Cafe [es]'},placeholder:false,corrections:[]}]`,
  nextCursor null; release collected, further collect expired. Foreign job stays
  job_not_found before invalid cursor; changed submit fingerprint stays conflict.
  `translation downgrade stops next provider call`: block first pass or retry
  wait, drop to 1, release; calls exactly 1, review/retry calls 0, actual first
  spend recorded once. A DB failure likewise starts no next call; release/collect
  have no new model work. Preserve lease fencing, cancellation/storage callback
  ordering and result retention assertions. `basic relay remains independently
  authorised at all three levels`: valid local-proof submit/handoff succeeds;
  grant/revision/origin/owner/expiry/allowance/kill-switch refusals and account
  signup/reset mail are identical before/after transition; zero new mail grants
  from transition. Address routes stay unavailable and keys absent from env.
- [ ] **Step 2: Observe RED locally only for pure runtime/parser cases and in CI
  for DB cases.** Native:
  `node --test deploy/test-cloud/venue-service-runtime.test.mjs` (pure only).
  **CI:** `pnpm --dir packages/translation exec node --test --test-timeout=30000 test/venue-service-translation.test.ts`;
  `pnpm --dir packages/registration exec node --test --test-timeout=30000 test/venue-service-relay.test.ts`.
- [ ] **Step 3: Implement admission/worker guards and validated mode propagation.**
  Assert all mode combinations in the compatibility table, constructor defaults,
  each account/storage/backup/manifest/reconcile/translation role, production
  venue refusal and startup invalid-config refusal before work. Keep new flag
  dormant in checked-in env/Compose. No live provider/deployment change.
- [ ] **Step 4: Observe GREEN; run legacy free-service proof and translation,
  relay and HTTP security/consent/paging suites in CI.** Preserve original checks;
  new mode adds stricter fresh-admission tests, not weaker legacy expectations.
- [ ] **Step 5: Commit `git commit -s -m "feat: require venue level two for new translation work"`.**

### Task D6: Qualify guard omissions, migration/recovery and branch lifecycle

**Files:** Create `scripts/venue-service-guard-probes.mjs`,
`scripts/venue-service-guard-probes.test.mjs`,
`packages/account-http/test/venue-service-guards.test.ts` (bounded CI wrapper),
`packages/registration/test/venue-service-upgrade-recovery.test.ts` and
`scripts/schema-upgrade-venue-service-fixture.mjs`. Extend the existing
`schema-upgrade-{fixture,receipt}.mjs`, `verify-schema-upgrade-receipt.mjs` and
corresponding tests with a separate proof version/mode, not changed old receipts.
Modify only current-release tail checks named below and the docs in the table.

**Interfaces:** Probe runner has `--pure|--database`, runs named tests in owned
complete candidate copies with dependencies and CI's disposable DB env, and emits
sanitised per-guard baseline/fault/restored case counts. CI wrapper explicitly
runs pure harness controls plus both modes and the new runtime/storage proof
files. Pure runtime tests must import only parsers/env builders, with no DB
fixture hooks. Add a native verifier test in
`scripts/verify-schema-upgrade-receipt.test.mjs` for every v7 missing/false/string/
extra field, dirty driver, wrong candidate/count, nonzero cleanup and equal pins.
Existing package `test/*.test.ts` discovery must execute it and the upgrade
wrapper. New fixture exports are
`seedVenueServiceAuthority(root:string,pool:Pool,state:object):Promise<object>`,
`venueServiceAuthorityState(pool:Pool):Promise<object>` and
`restoredVenueServiceAuthority(root:string,pool:Pool,proof:object,expected:object):Promise<void>`;
these private synthetic objects follow C's fixture convention, never public data.
Name the wrapper tests `venue service guards detect all omissions` and
`venue service exact head upgrade and recovery is qualified`.
Give wrappers explicit test-level timeouts within the current eight-minute
job budget; ordinary tests keep 30 seconds. Never edit CI to conceal omissions.

- [ ] **Step 1: Add harness-control RED before runner code.** Zero cases, skipped
  selected case, unexpected/missing test name, setup/import error, timeout, zero/
  multiple mutation matches and an undetected negative-control mutation must all
  reject qualification. Require baseline/fault/restored distinct runs; source
  text presence alone is not evidence. Native:
  `node --test scripts/venue-service-guard-probes.test.mjs`.
- [ ] **Step 2: Implement distinct omissions in disposable copies only.** For
  each row remove precisely that guard, see the named behavioral assertion fail
  for its expected wrong value, restore original bytes and see it pass. Keep
  all original refusal assertions in place. Pure probes can run natively;
  every PostgreSQL/storage probe runs in actual CI only.

| Guard omitted separately | Required detection |
| --- | --- |
| Translation level floor; trial end exclusion (two pure faults) | Registered translation incorrectly true; 30 November incorrectly connected. |
| Composite venue binding | Foreign/same-org-other-business call returns a grant or changes a row instead of scope refusal. |
| Raw `execute` transition hook | Authority stays 1/setup ready after raw downgrade instead of revision 2/unconfigured. |
| Venue lock before installation | The controlled third-connection installation lock is blocked instead of available while policy waits. |
| Downgrade persisted setup clearing | Raw service rows remain ready instead of the three exact unconfigured/`{}` rows. |
| Cached installation masking | Replayed v2 response exposes the retained translation configuration instead of `{}`. |
| Final post-wait proof/session recheck | Revoked/expired/changed-binding proof returns keys instead of its original refusal. |
| Private writer mode comparison | Legacy revision 1 key survives new-mode generation 1 instead of storage 403. |
| Post-provider generation comparison | A 2→1→2 round trip returns credentials/keys instead of refusal and zero publication. |
| Active route filter; incoming staged route filter (two faults) | Denied sibling UUID appears in the corresponding exact route array instead of absence. |
| Direct writer generation comparison | Old storage writer works after a round trip/restart instead of genuine storage refusal. |
| Retained expiry permission check | A stored snapshot is removed at 1 instead of deletion count 0. |
| New translation admission; post-wait provider permission (two faults) | Jobs/provider calls become 1 at 1 instead of 0; a second review/retry call occurs instead of total 1. |

- [ ] **Step 3: Observe real migration RED, then implement/qualify recovery in CI.**
  New schema is needed because C's venue revision does not cover trial mutations
  and D needs durable opt-in/generation without rewriting C or org sentinel meaning.
  Reconfirm the allocated filename; if 046 is free, current total becomes 46,
  new tail/index 45 is `046_venue_service_authority.sql`, 045 stays at index 44.
  Name the DB tests `045 upgrades to venue service authority without changing old bytes`
  and `interrupted venue service migration rolls back DDL ledger and retries`;
  assert the old 45 ledger rows byte-identical, authority row count 0 after
  upgrade, no new relation/ledger row after interruption, exactly one new ledger
  row after retry and no further change on repeated migration.
  Apply these test prerequisites in D2: replace **only current-tail/total checks** in registration
  `test/{registration,schema-compatibility,backup-verification-migration,forward-observations-migration}.test.ts`
  and translation `test/result-storage-upgrade.test.ts`: expect exactly those new
  total/tail values, preserve every old index, prefix/digest/row comparison and
  add `hasReleaseMigrationCount('45')===false` for the new current manifest.
  Preserve old behavioral assertions, pinned release fixtures, golden data and
  SQL 045. Add the 45 release at
  `b338275c3ba4e2b211d7617b03d38e95b916ee7c` to `migrationRelease`; use its
  real migrate function, not a manually truncated current manifest.
  If another slot lands first, record its exact name/count and append D after it;
  update only D's new current-release expectations together.

  Add proof `--venue-services --old <full-b338275c-hash> --new <candidate-hash>`
  alongside existing modes; reject symbolic/equal/mixed/missing revisions.
  Version 7 receipt keeps existing common security/recovery checks and adds
  `venueServices` exact booleans: `oldSqlUnchanged`, `oldRowsPreserved`,
  `defaultOff`, `interruptedRollback`, `restartIdempotent`, `foreignScopeRefused`,
  `newBackupRestored`, `restoredAuthority`, `restoredTrials`, `restoredEvents`,
  `restoredKeysAndHolds`, `restoredRetryStable`, `staleWriterRefused`,
  `oldBackupUpgradeUnenrolled`, all strictly true. Require actual stopped-consumer
  45→46 upgrade, concurrent/idempotent migration, interrupted DDL+ledger rollback
  and successful retry. Old consumer refuses new ledger; new consumer refuses
  old/missing/changed/future ledger. Compare all old rows/digests/applied times.
  Create separate pre-upgrade and populated post-upgrade backups; restore each
  into another owned DB with matching external synthetic keys and storage state.
  Old backup upgrade leaves authority empty/permission registered; populated
  restore preserves generations, facts, trials, event retries, objects/key
  versions and recovery holds. Wrong/missing keys refuse. Restoring old writer
  state against newer DB generations must withdraw it before readiness.
  Use `pg_restore --exit-on-error`, keep the empty-search-path helper behavior,
  preserve the upgraded DB, and record cleanup/limitations. No reverse migration,
  live recovery claim or old binary on new schema. Version 6's 44→45 receipts and
  all earlier receipt formats/expectations stay historical and unchanged.

  The shipped `billing-upgrade-recovery.test.ts` binds v6 to HEAD, while its
  verifier requires new count 45. Adding 046 would break that invocation.
  Explicit replacement: that wrapper runs its original test unchanged in an
  installed, clean owned checkout pinned to delivered
  `3d3c3def00bf27d60f2d97f5c23cd4acc1aebf7d`. Assert v6, old count 44, new count
  45, old hash `1a3e43e885edfbe9932c835e3f4fb8929718b2dc`, driver/new hash
  `3d3c3def00bf27d60f2d97f5c23cd4acc1aebf7d`; retain every original recovery
  assertion there. This invocation-only wrapper change belongs to D2's
  test prerequisites; D6 adds its current-candidate replacement proof.
  The new D wrapper separately requires v7, driver/new equal candidate HEAD,
  old full b338275c/count 45 and new count 46. Historical execution is preserved;
  v6 must not accept arbitrary newer schemas. If the slot changes, pin its real
  preceding release and exact counts for v7 only.

- [ ] **Step 4: Collect named GREEN and coverage at the implementation head.**
  Before every implementation step, sign off/push tests first and observe its
  actual named RED in the selected CI package, including migration execution;
  save head, job, name and assertion. Do not proceed on unavailable DB or import/
  setup-only failure when qualifying a specific guard. Repeat on implementation
  head for GREEN. **CI:**
  `pnpm --dir packages/account-http exec node --test --test-timeout=360000 test/venue-service-guards.test.ts`;
  `pnpm --dir packages/registration exec node --test --test-timeout=360000 test/venue-service-upgrade-recovery.test.ts`.
  Require all 16 detected omissions, passing restored controls, real storage
  refusal and both restored databases. Inspect package discovery, executed
  nonzero counts, coverage and sanitised receipts; skips/old-head evidence or a
  summary without these executions block readiness. Let CI own required
  PostgreSQL suites and coverage. Until 3 November run no Docker,
  `scripts/test-postgres.mjs`, `pnpm test` or whole-workspace suites locally.
  Focused native checks are D1, D5 pure runtime,
  `node --test scripts/venue-service-guard-probes.test.mjs scripts/schema-upgrade-fixture.test.mjs scripts/verify-schema-upgrade-receipt.test.mjs`,
  `node scripts/venue-service-guard-probes.mjs --pure`, then `pnpm typecheck`; normal push hooks remain intact.
- [ ] **Step 5: Commit and finish through the driver.**
  `git commit -s -m "test: qualify venue service guards and authority recovery"`.
  Announce readiness for `finish-branch`. The full production-code branch needs
  initial rebase then one `claude-seat.sh review-run` whole-branch run-it review
  in an installed throwaway checkout containing the complete candidate tree.
  Triage findings in the feature checkout, focused checks, normal signed-off
  commits/hooks and exact-head CI after fixes. A later rebase alone retains that
  review; inspect the result and qualify the new head again. Require every
  **actual** selected job final at the PR head: changes/selection, documentation/
  scripts, root 1–4, typecheck, package shards including registration/backups/
  remote/account/translation, receipts, strict summary, and all actual cloud-cost
  discover/conformance jobs. Audit justified skip/reuse evidence; no green-summary
  shortcut. Under shared `main.lock`, fetch/read fresh main and check
  `git merge-base --is-ancestor <fresh-main> <qualified-head>` before the driver's
  `land-branch`; if it fails, rebase/requalify first. Install the merged result
  through the normal managed workflow, clean only owned worktree/environment/
  recorded processes, and verify all independent main CI jobs name the exact
  merge SHA and finish successfully. Landed D still grants no live enablement.

The owner price/allowance slots, legal exit/retention and hosted-stop qualification
remain with their named slices. They do not block these synthetic engineering
choices, and passing D does not settle them.
