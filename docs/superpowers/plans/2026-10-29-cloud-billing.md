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
3. Lock venues in UUID order: all new-mode permission reads and transitions take
   `FOR NO KEY UPDATE` immediately because clock expiry can invalidate setup;
   legacy readers keep SHARE. Never SHARE then upgrade. This existing
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
`effectiveVenueLevel(base:BillingLevel,trials:readonly TrialView[],today:CivilDate):BillingLevel`
and `paidGrantWindow(base:BillingLevel,trials:readonly TrialView[],today:CivilDate):{until:CivilDate|null}|null`.
The latter returns null for no current level-2 grant, `{until:null}` for an
unbounded grant, otherwise its first uncovered civil day. These are new interfaces, not claimed existing exports. Reject malformed facts/
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
  `paid setup window ends at the first real grant gap`: touching connected
  `[2026-10-31,2026-11-30)` and hosted `[2026-11-30,2026-12-30)` end at
  30 December; starting the latter on 1 December instead ends the first window
  at 30 November. A connected base is unbounded, registered without a current
  trial returns null, and no future interval bridges an uncovered day.
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
`readVenuePermissions(client:PoolClient,venueId:string,mode:'test-venue-levels'):Promise<VenuePermission>`,
`requireVenueService(client:PoolClient,venueId:string,service:VenueService,mode:PlanMode,lock?:'SHARE'|'NO KEY UPDATE'):Promise<void>`;
add `BillingStore.transition(scope:BillingScope,event:BillingEvent,command:PermissionCommand):Promise<BillingReceipt>`.
An internal `applyPermissionTransition(context:BillingContext,command:PermissionCommand,
enrol:boolean):Promise<BillingValue>` wraps `applyVenueCommand` on the same client.
`readVenuePermissions` is the only new-mode authority, including batch consumers;
`requireVenueService` branches explicitly: existing returns without new reads,
legacy uses `readVenuePlan`/`planAllows`, new mode uses the new reader/rules.
New-mode reads always take venue NO KEY UPDATE at their first policy read and
synchronise the stored grant window before installation locks. The optional
`requireVenueService` lock argument remains for legacy compatibility only; it
cannot weaken new-mode locking. Replacement therefore needs no later lock upgrade. Legacy mode refuses enrolled venues;
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
  installations, B/C revisions and grants stay byte-identical.
  `expired trial setup never revives across a late transition`: provision an
  enrolled connected trial, move the controlled DB day to its end with G/readers
  stopped, then separately test delayed end followed by the independent hosted
  trial, and a late extension before finalisation. Each resets all three rows
  before restored permission, advances the generation/configuration once per
  transaction, and repeated synchronisation/replay changes nothing further.
  `an unobserved gap between future trials clears old setup`: record non-touching
  future intervals, skip every read across the gap, then read during the later
  interval; setup is cleared before that read can authorise. Touching intervals
  and an extension before expiry keep existing setup. Legacy org toggle
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
  Repeat cached replies, active/incoming routes and actual stale-writer refusal
  after both expired-trial late-transition cases and an unobserved future-trial
  gap from D2; only explicit reprovision restores access. Keep keys, objects and
  Cloud reader unchanged. No G/reconciler runs during the gap.
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
| Stored grant-window expiry fence | A late extension or later trial exposes old ready setup/routes/writer after an unobserved gap instead of cleared setup and stale-writer refusal. |
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
  Require all 17 detected omissions, passing restored controls, real storage
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

### Consumer and ownership map

Re-run `rg -n 'recordUsageEvent|usageEventTypes|usageSourceKinds|usageReconciliationSourceNames|UsageSummary|relay_reservations|monthSpend|spendingPolicy|trialAllowanceTier|beginForward|renderHaproxy|forwardBinding|PlanMode' packages apps deploy scripts`
before implementation. Read/classify new matches before changing a gate or unit.

| Existing source/consumer | E boundary and coordination |
| --- | --- |
| Registration `src/usage-metering.ts`: `recordUsageEvent(client,input)`, `UsageReconciler.runOnce(limit=100)`, `UsageStore.summary(token,{organisationId})`; migrations 025/039 | Add one explicitly paired traffic event/source, preserving all other unit checks, immutable events and replay comparisons. Traffic source and ledger commit together; collector replay repairs lost replies, not the four-source historical reconciler. |
| Registration `src/usage-reconcile-cli.ts`; operations `src/{status,metrics}.ts`; account-http `src/usage.ts`; portal `src/{usage-types,usage-controller,api}.ts`; `deploy/local-stack/usage-proof.mjs`, `scripts/scheduled-usage-proof{,.test}.mjs` | Keep v1 summary shape and its four reconciliation sources/freshness semantics. No traffic field silently added to v1 or relabelled old receipt. E4 exposes a separate internal venue/day read with its own completeness. Retain original usage/HTTP/portal assertions. |
| Registration `src/{billing-config,billing-types,billing-store,billing-venues,billing-trials}.ts` | Reuse `BillingScope`, `BillingLevel`, `TrialView`, date validation, scoped venue/trial facts and `trialAllowanceTier(boolean)`. New allowance modules own their types/errors; no enlargement of `BillingCommand`, event meaning, price defaults or paid-history meaning. C's `set_method` pointer is the internal synthetic payment-method fact, not provider qualification. |
| Migrations 001/003/045; registration `src/{signup,relay-grants}.ts` | Account ID is `cloud_accounts.id`, not organisation/business ID. Signup makes an owner membership; schema allows several. For relay, use the current verified grant's `account_id` and recheck that owner's membership, never select an arbitrary organisation owner. Future P3 sole-owner migration remains P3's. |
| Remote `src/{config,gateway-cli,authority,gateway-forward-reports,forward-report,forward-report-writer,forward-report-collector,forward-observations}.ts` | Current HAProxy has per-installation staff backends but shared public backends and no byte export. Health v1 reports contain causes, not traffic; their five-minute expiry, reporter sequence, pruning and D's current-route checks stay independent. Add a separate signed traffic audience/spool; reuse reporter key registration, not health observation sequence/state. |
| Remote `src/{placement,reconciler,probe,probe-runner,probe-observations}.ts` | Manifests bind routes; v2 binds reporter/generation/revision. Current public probes really complete the challenge and staff probes exchange TLS bytes. Merely counting a positive HAProxy counter would count probes. E3/E4 isolate trusted operational origins before collecting user counters; probes and installation ledger operations never supply trial-use facts. Preserve routing, permissions and reporter recovery checks. |
| Registration `src/{relay-grants,relay-messages,relay-worker,relay-bounds,relay-control,email-outbox}.ts`; account-http `src/relay-messages.ts` | `RelayGrantStore.reserve(client,authenticated,input)` already serialises `relay-account:` and retains a debit per message. New mode adds monthly accounting in that transaction, after independent grant/origin/owner checks, before queue insertion. Worker replays the original reservation at handoff; it must not mint a new month's debit. Keep bounds, kill-switch, cancellation, SMTP uncertainty and identity/account mail independent. |
| Translation `src/{machine,job-store,worker,batch-runner,retention}.ts` | `TranslationMachine.execute` finds authenticated submit replay before new admission; `createJob` checks estimate against `monthSpend`; worker `mayCall/spent/attempted` accounts calls, lease and cancellation. E5 reserves requested items once per new job; keeps the separate money safety cap and cost ledger, callback order, lease fencing and retention. D owns new level permission and post-wait permission checks. |
| Account-http `src/{app,server,server-cli}.ts`; translation `src/worker-cli.ts`; `deploy/{local-stack/runtime,test-cloud/runtime,test-cloud/account-worker,test-cloud/service-runtime,test-cloud/remote-runtime}.mjs` | Additive options only after concrete D/P3/D79 clearance. Defaults do no E reads/writes; no environment fallback enables E. New focused fixture tests import pure options separately from DB hooks. No P1/P2 deployment edits. |
| `docs/address-lookup-scope.md`, address-suggestions spec/plan; D pure service floors | Address lookup is a configuration/service boundary only; its future confirmed-address reservation must compose with provider budgets/manual entry. SMS/rota are unbuilt: configuration slots and future boundary tests only. No invented HTTP service, solver, SMS provider or provider call. |
| Registration `src/migrate.ts`, `test/fixtures/migration-release.ts`; `scripts/{schema-upgrade-fixture,schema-upgrade-receipt,verify-schema-upgrade-receipt,database-recovery-migrations}.mjs` and tests | Append a coordinated migration and separate proof mode/version. Preserve old SQL/ledgers, historical receipts and exact schema checks; E6 specifies current-tail and historical-wrapper prerequisites explicitly. |

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

### Task E1: Define published allowance shapes and pure monthly rules

**Files:** Create `packages/registration/src/billing-allowance-rules.ts` and
`packages/registration/test/billing-allowance-rules.test.ts`. No export edit yet.

**Interfaces:** Reuse `BillingLevel`, `TrialView`, `CivilDate`, `TrialUsage` and
`trialAllowanceTier`. Produce `AllowanceService` (the five names in the table),
`AllowanceOptions={mode:'test';calendar:'UTC'}`,
`AllowanceVersion={revision:number;effectiveFrom:CivilDate;limits:Record<BillingLevel,Record<AllowanceService,string>>;unpaidTrial:{content_translation:string;rota_solver:string}}`;
quantities are canonical nonnegative decimal strings <= signed bigint maximum.
Produce `validateAllowanceVersion(value:unknown):AllowanceVersion`,
`allowanceMonth(day:CivilDate):{from:CivilDate;until:CivilDate}` and
`allowanceLimit(config:AllowanceVersion,input:{base:BillingLevel;trials:readonly TrialView[];day:CivilDate;hasPaymentMethod:boolean;service:AllowanceService}):bigint`.
The last computes the highest base/active-trial level solely to select an allowance,
not to grant a service; it does not depend on D1. Reject extra/malformed values
using `AllowanceError extends Error`, `constructor(code:AllowanceErrorCode)` with
readonly `code:AllowanceErrorCode`. That union is `invalid_allowance_input`, `allowance_unavailable`,
`allowance_conflict`, `allowance_exhausted`, `allowance_scope_not_found`.

- [ ] **Step 1: Write named failing assertions.** Use fixture `TEST_ALLOWANCES`,
  never production defaults: registered email/address/SMS `2/2/0`, connected
  `4/4/0`, hosted `6/6/0`; translation/rota `0/0`, `6/4`, `8/6`; unpaid trial
  translation/rota `2/1`. In `allowance months and trial tiers do not create pots`:
  `assert.deepEqual(allowanceMonth('2028-02-29'),{from:'2028-02-01',until:'2028-03-01'})`.
  Stored trial `[2026-10-31,2026-11-30)` selects translation `2n` on 29 November
  without method, `6n` with method; on 30 November selects registered `0n`.
  Assert email `4n` in both trial tiers and paid/no-trial translation `6n` even
  without method. Future/converted/lapsed trials add nothing. In `allowance
  configuration has no implicit production values`, assert missing/extra fields,
  leading zeros, fractions, negatives, invalid month-start, unknown level/service,
  trial values above corresponding connected/hosted full limits and
  `9223372036854775808` reject; explicit `0` stays zero, never unlimited.
- [ ] **Step 2: Run RED:** `node --test packages/registration/test/billing-allowance-rules.test.ts`.
  Use runtime import/export assertions initially, then observe the named boundary
  failures. No PostgreSQL setup or stub implementation to bypass RED.
- [ ] **Step 3: Implement only E1's pure interface and fixed validation.**
- [ ] **Step 4: Repeat E1's command plus B's unchanged `billing-trials.test.ts`;
  require nonzero cases, no failures/skips and `pnpm typecheck` exit 0.**
- [ ] **Step 5: Commit:** `git commit -s -m "feat: define monthly allowance configuration and trial tiers"`.

### Task E2: Publish configuration and serialize durable reservations

**Files:** Create `packages/registration/src/billing-allowances.ts`,
`packages/registration/test/billing-allowances.test.ts`,
`packages/registration/test/billing-allowance-migration.test.ts` and the coordinated
`packages/registration/migrations/<E-slot>_billing_allowances_traffic.sql`.
Modify `packages/registration/src/{migrate,index}.ts` only after clearance;
apply E6's enumerated release-test/wrapper prerequisites in this test-only stage.

**Interfaces:** Produce `AllowanceConfigStore(pool:Pool)` with
`publish(value:AllowanceVersion):Promise<AllowanceVersion>` and
`effective(month:CivilDate):Promise<AllowanceVersion>`; internal
`readAllowanceVersion(client:PoolClient,month:CivilDate):Promise<AllowanceVersion>`.
Produce `reserveAllowance(client:PoolClient,input:{accountId:string;venueId:string;installationId:string;service:AllowanceService;operationId:string;binding:string;units:bigint}):Promise<AllowanceReservation>`;
`AllowanceReservation={id:string;month:CivilDate;revision:number;units:string;state:'held'|'spent'|'released'}`;
`spendAllowance(client:PoolClient,id:string):Promise<AllowanceReservation>`,
`recordAllowanceAttempt(client:PoolClient,id:string,attemptStartedAt:string):Promise<void>` and
`releaseUnstartedAllowance(client:PoolClient,id:string):Promise<AllowanceReservation>`
are internal transaction helpers, never public customer authority. Reserve derives
the composite venue scope, current method, level/trials and month from locked
stored facts, and verifies the trusted caller-derived account's current ownership
and installation-to-venue binding. Relay derives that account from the verified
grant; translation derives it from E5's exact current consent owner. A machine
proof never supplies a Cloud account ID. Operation identity is
`(service,installationId,operationId)`, with immutable account/venue/body binding;
a replacement installation shares the venue budget, not the old operation ID.
Release requires the owning service's locked never-attempted fact, not a caller
boolean. Missing transactions refuse. Defaults do not call these helpers.

- [ ] **Step 1: Write DB RED cases.** `one account last unit is atomic across venues`:
  first spend one message against test limit `2`, then two account-owned registered
  venues each request `1n` email unit; assert racing admitted count `1`, refused
  count `1`, total `2n`, no losing
  reservation. Different account remains `0n`; foreign org/business, a crossed
  installation/venue pair and changed
  owner refuse with zero writes. `reservation replay does not refill after
  rollover`: same operation/binding returns the same ID/month on reconnect after
  1 December; changed units/account/venue/binding under that identity conflicts.
  A different service has its own operation namespace and must pass fresh admission.
  `transitions
  keep one history`: spend 2 registered units, switch connected then registered,
  assert respective remaining `2n` then `0n`, not `4n/2n`; method/trial changes
  retain translation held/spent `2n`. `held release cannot refund started work`:
  held 2 releases once to total 0; spent 2 remains 2 after release refusal.
  Trigger failure rolls back configuration/reservation/service effects together.
  Publication identical retry returns revision 1; changed revision payload refuses,
  future revision not selected early; new month starts empty without deleting old.
  SQL foreign/composite ownership rejects `23503`, duplicate identity `23505`,
  invalid quantity/state `23514`, immutable facts mutation `55000`.
- [ ] **Step 2: Sign off/push test-only changes and observe named RED in actual CI:**
  `pnpm --dir packages/registration exec node --test --test-timeout=30000 test/billing-allowances.test.ts test/billing-allowance-migration.test.ts`.
  Missing relation/export is initial RED; require intended behavior failures for
  guards. Setup/import-only errors, unavailable DB, timeout or skips do not qualify.
- [ ] **Step 3: Implement the small store and additive schema.** Tables:
  `billing_allowance_versions` (immutable fixed config),
  `billing_allowance_reservations` (service/installation/operation unique,
  account FK and composite-owned venue/installation binding,
  immutable units/binding/month/revision, monotone held→spent or held→released,
  nullable once-set observed-attempt timestamp),
  `remote_traffic_processes` (key `(cell_id,gateway_id,generation,process_id)`,
  saved reporter public key/binding, contiguous checkpoint and gaps),
  `remote_traffic_samples` (immutable signed report/route deltas/day; unique
  process key plus sequence/installation/channel and globally unique source reference).
  Add `remote_traffic_coverage` for the expected-route journal and signed process
  boundaries above. Incomplete boundaries survive restart/restore. No generic
  metadata column. Retain referenced parents, no cascading delete.
  Reserve locks absent buckets with advisory keys, sums held+spent using bigint,
  and inserts only if remaining fits. Email reservations require exactly `1n`;
  translation requires a positive requested-item count matching its job. Publication uses its own schema-scoped
  advisory key, fixed-shape canonical comparison and increasing effective months.
  Account/venue totals derive from one reservation history, not resettable
  per-plan counters. Add traffic ledger CHECK alternatives in the new migration
  only, preserving every existing event/source/unit alternative from 025/039.
- [ ] **Step 4: Observe E2 GREEN at the implementation SHA in CI**, with C's
  unchanged schema/store/venues/payment and usage suites; locally E1/types only.
- [ ] **Step 5: Commit:** `git commit -s -m "feat: publish country allowances and reserve service use atomically"`.

### Task E3: Define traffic reports, counter deltas and restartable spool

**Files:** Create remote-access `src/{traffic-report,traffic-counters,traffic-spool}.ts`
and `test/{traffic-report,traffic-counters,traffic-spool}.test.ts`. These pure/file
tests use native Node, no gateway processes, DB or Docker.

**Interfaces:** Produce `TrafficCounter={ingress:string;egress:string}`,
`trafficDelta(previous:TrafficCounter,current:TrafficCounter):{ingress:bigint;egress:bigint}`;
`readTrafficCounters(csv:string,backends:ReadonlyMap<string,string>):Map<string,TrafficCounter>`
(map values are generated route keys, not supplied hostnames).
`TrafficEntry={installationId:string;venueId:string;revision:number;routeBinding:string;channel:'staff'|'public';ingress:string;egress:string}`;
`TrafficReport={version:1;audience:'waitron-cloud-remote-traffic';cellId:string;gatewayId:string;generation:number;processId:string;sequence:number;from:string;until:string;complete:boolean;entries:TrafficEntry[]}`.
`from/until` are canonical UTC instants, entries are deltas, and report sequence is
process-local, positive and safe. Produce `signTrafficReport(report:TrafficReport,key:KeyObject):ManifestEnvelope`,
`verifyTrafficReport(envelope:unknown,key:KeyObject):TrafficReport` (structural/crypto
validation; E4 does time/authority). `TrafficSpool({directory:string;maxBytes:number})`
provides `append(report:TrafficReport,envelope:ManifestEnvelope,counters:ReadonlyMap<string,TrafficCounter>):Promise<void>`,
`pending():Promise<ManifestEnvelope[]>`, `ack(processId:string,sequence:number):Promise<void>`
and `restore():Promise<{processId:string;sequence:number;counters:Map<string,TrafficCounter>;complete:boolean}>`.
Append/ack use an owned exclusive file lease and atomic durable checkpoints.

- [ ] **Step 1: Add `traffic counters are exact deltas and midnight is explicit`**:
  `assert.deepEqual(trafficDelta({ingress:'100',egress:'40'},{ingress:'110',egress:'65'}),{ingress:10n,egress:25n})`;
  equal counters total `0n`; decrease, wrap, duplicate/missing CSV rows and delta
  sum `9223372036854775808n` refuse. Keep `9007199254740993` exact. An interval
  ending `2026-11-01T00:00:00.000Z` belongs to `2026-11-01`. `traffic spool retries
  original bytes after crashes`: append, lose reply, restore and resend yields
  identical envelope/process/sequence; ack twice removes once; checkpoint/spool
  partial-write, full capacity, unknown old process and lost final sample expose
  complete false. `traffic signature cannot carry content or cross audiences`:
  changed byte/key/audience, extra URL/header/content field, oversized report,
  >128 entries and malformed numbers reject before output.
- [ ] **Step 2: Run RED:** `node --test packages/remote-access/test/traffic-report.test.ts packages/remote-access/test/traffic-counters.test.ts packages/remote-access/test/traffic-spool.test.ts`.
- [ ] **Step 3: Implement those interfaces only.** Keep cumulative parsing separate
  from signed deltas, never reuse health `observationSequence` or report TTL.
- [ ] **Step 4: Repeat E3's command and require nonzero GREEN/no skips**, then
  `pnpm typecheck`. Simulated crash controls operate only on owned temp files.
- [ ] **Step 5: Commit:** `git commit -s -m "feat: define bounded traffic deltas and durable collector replay"`.

### Task E4: Authenticate traffic into the ledger and prove real gateway counts

**Files:** Create remote-access `src/{traffic-store,traffic-collector,traffic-coverage,traffic-cli}.ts`,
`test/{traffic-store,traffic-collector,traffic-gateway}.test.ts`,
`packages/registration/src/billing-trial-usage.ts`,
`packages/registration/test/billing-trial-usage.test.ts`,
`deploy/test-cloud/allowance-traffic-proof.test.mjs` and
`scripts/verify-allowance-traffic-receipt{,.test}.mjs`.
Modify registration `src/{usage-metering,index}.ts` and remote
`src/{config,gateway-cli,placement,reconciler}.ts` only after source clearance.
The last two paths journal expectations for direct and reconciled publication;
retain their existing permission/publication behavior. No health-report,
manifest-wire or probe-policy rewrite.

**Interfaces:** Produce a separate
`TrafficMapping={country:'ES';environment:'test';cellId:string;directory:string;writerUid:number;readerGid:number}`;
do not change `ForwardReportMapping.file` meaning. `TrafficStore(pool:Pool)` has
`record(mapping:TrafficMapping,envelope:unknown):Promise<{state:'accepted'|'replay';processId:string;sequence:number}>`
and `days(scope:BillingScope,venueId:string,from:CivilDate,until:CivilDate):Promise<{complete:boolean;days:Array<{on:CivilDate;bytes:string}>}>`.
Reuse private file/mapping ownership checks from the inspected collector pattern,
but a separate spool reader; do not make health pruning delete traffic.
`collectTraffic(mapping:TrafficMapping,store:Pick<TrafficStore,'record'>):Promise<void>`
reads only validated process/sequence filenames within the mapped private directory,
with the same no-symlink/regular-file/owner/group/size checks; it acks only durable
receipts. New `TrafficCoverageStore(pool:Pool)` exposes internal
`expect(client:PoolClient,manifest:AcceptedGatewayManifest):Promise<void>` for the
country journal and `recordLifecycle(mapping:TrafficMapping,envelope:unknown):Promise<void>`
for signed supervisor records. A lifecycle record binds process UUID, manifest
digest, canonical start, optional end/final sequence and predecessor UUID under
the dedicated traffic audience. Exact retries preserve it; changed boundaries
conflict. Explicit test enrolment snapshots current and still-valid old authority,
marks unknown history uncovered and enables no production traffic collection.
`TrafficStore.days` checks the interval invariant against the journal and every
process, rather than trusting report complete flags. `renderHaproxy` adds optional
`traffic?:{socket:string;operationalSources:readonly string[]}` to its existing
options; absent means byte-identical legacy rendering. Gateway traffic is enabled
only by explicit validated test options, fresh signed v2 authority and separate
private reporter/spool configuration. Reject non-test binding; never auto-enable
from health reports. `readTrialUsage(client:PoolClient,scope:BillingScope,venueId:string,trial:TrialView):Promise<{complete:boolean;usage:TrialUsage}>`
reads exact traffic dates and actually started jobs; G must check complete first.
For the supplied trial, re-read its scoped stored row and require identical bounds/
state before aggregating; caller-provided dates cannot select another trial.
The new verifier owns `TrafficProofReceipt={version:1;kind:'cloud-allowance-traffic';
cloudHead:string;cloudTree:string;scope:'local-fixtures';productionEnforcement:'off';
checks:{backendDeltasMatch:boolean;operationalDaysZero:boolean;userDaysThree:boolean;
restartReplayStable:boolean;crashGapIncomplete:boolean;foreignScopeRefused:boolean};
suites:Array<{id:'counters'|'collector'|'gateway';tests:number;passed:number;failed:number;cancelled:number;skipped:number;todo:number}>;
cleanup:{containers:number;volumes:number;processes:number};limitations:string[]}`.
Require exactly those suite IDs once each, all checks strictly true, tests>0,
passed=tests, all other counts/cleanup zero and nonempty limitations. Bind clean
head/tree to the wrapper's candidate. This is synthetic proof, not live measurement.

- [ ] **Step 1: Add `traffic atomic replay and scope survive reconnect`**: 10+25
  bytes creates exactly one ledger quantity `35`, repeated/reconnected report
  remains `35`, changed same key conflicts; failed ledger insert leaves checkpoint/
  source unchanged and retries once. Forged/foreign country/cell/venue/business,
  revoked reporter, old generation/new report, changed route revision and sequence
  gaps add `0` events; exact accepted replay after rotation adds `0`. Queued
  verification rechecks current authority. `only real user bytes make trial days`:
  positive samples on 1/1/2 November give days 2 and `trialWasUsed=false`; add
  3 November gives 3/true. Probes, health, installation operations and zero samples
  give 0; dates before start/on end excluded; gaps give complete false.
  `traffic silence and handoff never prove zero use`: no reports returns false;
  zero reports through 10 November then exporter death with the gateway serving
  through 30 November returns false without ingesting any gap marker. Contiguous
  sequences with a one-second time hole return false. A clean process at sequence
  1 whose predecessor lacks a final sample returns false. Missing public-channel
  coverage, late enrolment, an unacknowledged interval, a reload tail or coverage
  ending before the trial does each returns false. Complete zero-byte intervals
  covering every journalled lifetime through the trial boundary return true/zero
  days; later expiry cannot erase an earlier uncovered tail. Real
  gateway fixture sends trusted operational TLS/public probes on three dates,
  asserts days `0`, then user traffic on three dates asserts days `3`. Include
  same-organisation sibling routing, both public/staff, no double inner-hop
  counting, live socket/reload, long connection across midnight, exporter restart,
  lost DB ack and child crash gap. Assert fixed fixture payload byte counts in
  synthetic transport; for real TLS assert measured ingress/egress positive and
  equality with selected HAProxy backend deltas, not guessed TLS overhead.
- [ ] **Step 2: Observe actual CI RED before adapters.**
  `pnpm --dir packages/remote-access exec node --test --test-timeout=30000 test/traffic-store.test.ts test/traffic-collector.test.ts`;
  `pnpm --dir packages/registration exec node --test --test-timeout=30000 test/billing-trial-usage.test.ts`.
  `test/traffic-gateway.test.ts` is the discovered, explicitly bounded 240-second
  CI wrapper invoking the new deploy proof and native verifier tests. Its setup
  builds an owned throwaway image from existing `deploy/local-remote/Dockerfile`
  (which copies the candidate remote sources), starts isolated fixture listeners
  and HAProxy, and uses CI's real disposable PostgreSQL. No full-stack image,
  installed `haproxy` assumption or optional-image skip. It must first fail the
  named byte/probe assertion, not fail to build/install/start. Record prerequisites
  and fix setup through the driver without editing foreign CI/install pins.
- [ ] **Step 3: Implement collectors and locked ingestion** under the decisions
  above. New reports require fresh reporter/route/test binding and <=5-second
  future skew; delayed spool reports may be old if contiguous and their recorded
  route authority is still verifiable, otherwise mark unavailable. Store only
  fixed typed aggregate fields and signed aggregate bytes. `recordUsageEvent`
  accepts positive traffic quantity only with the new source and nonnull venue;
  preserve all old source/unit constraints. Keep v1 summary and reconciler shape.
  Trial usage counts translation when E5 records actual first-attempt admission;
  until E5, do not pretend queued/`started_at` lease selection proves a call.
- [ ] **Step 4: Require exact-head CI GREEN**, including the wrapper's actual
  HAProxy/DB execution with zero skips, plus original haproxy/forward-authority/
  forward-observations/probe/usage tests. Receipt version 1, kind
  `cloud-allowance-traffic`, clean head/tree, test-only scope, enforcement off,
  explicit counters/complete-gap checks and nonzero per-suite counts; verifier
  rejects missing/false/string/extra fields, wrong head, skips and nonzero cleanup.
  Run pure verifier locally: `node --test scripts/verify-allowance-traffic-receipt.test.mjs`.
- [ ] **Step 5: Commit:** `git commit -s -m "feat: record authenticated venue traffic without charging"`.

### Task E5: Attach allowances to relay and translation without weakening gates

**Files:** After D/P3 clearance, modify registration `src/{relay-grants,relay-messages,relay-worker}.ts`,
translation `src/{consent,machine,job-store,worker,batch-runner,retention,worker-cli}.ts`,
account-http `src/{app,server,server-cli}.ts` and the exact runtime paths in the
consumer map. Create `packages/registration/test/billing-allowance-relay.test.ts`,
`packages/translation/test/billing-allowance-translation.test.ts`,
`packages/account-http/test/billing-allowance-runtime.test.ts` and
`deploy/test-cloud/allowance-runtime.test.mjs` (pure option/env tests).
No edits to `email-outbox.ts`, providers, archived prompts or original test bodies.

**Interfaces:** Consume E1's `AllowanceOptions`.
Append `allowances?:AllowanceOptions` after D's planned `planMode` argument on
`RelayGrantStore`, `RelayMessages`, `RelayWorker`, `TranslationMachine`; add the
same optional property to TranslationWorker's existing options and account app/
server options. Missing options preserves old behavior exactly; test option
requires D's qualified `test-venue-levels` integration and test venue. D's future
`VenuePermission=BillingScope&{venueId:string;level:BillingLevel;revision:number}`,
`readVenuePermissions(client,venueId,'test-venue-levels')` and
`requireVenueService(client,venueId,service,mode,lock?)` are **planned**, not on main.
Do not manufacture them or return organisation `paid` as a venue level.
Keep `BatchHooks.mayCall/spent/attempted/wait` and D's optional `stillPermitted`.
Add optional `beforeProvider?():Promise<boolean>` to BatchHooks; it durably spends
the held admission with current job lease immediately before the first call.
False means no call; callback/storage failure escapes, never becomes a retry.
Extend the internal hook to `attempted(attemptStartedAt?:string):Promise<void>`;
old consumers may ignore the optional argument. `runPass` captures the canonical
call-start instant immediately before `respond` and supplies it after the response
or throw, preserving spent-then-attempted ordering. A later confirmed attempt does
not close an earlier unresolved pre-call interval or manufacture its start date.
Produce internal `readAllowanceConsentActor(client:PoolClient,venueId:string):Promise<{accountId:string;consentId:string}>`
in `translation/src/consent.ts`. Preliminary lookup identifies the exact active
current-version consent row, never an arbitrary owner membership. Lock that
account, verified credential and owner membership before organisation/business/
venue locks, then re-read the same consent ID/owner under the existing translation
consent lock. Withdrawal, replacement, disablement or ownership loss during waits
refuses new admission. Bind the reservation to that actor; authenticated exact
job replay keeps its original binding without selecting a later owner or another
debit. Keep the signed machine wire and public boolean hasConsent API unchanged.

- [ ] **Step 1: Write `monthly relay keeps account debit through handoff`**:
  account limit 2 across two venues admits message A/B, C raises
  `allowance_exhausted` with no queue row. Retry A, restart worker, cross month,
  cancel/fail/uncertain delivery leaves total 2, new-month debit 0 for A. Reject
  foreign binding, revoked/expired owner/grant/origin/lease and operator stop
  exactly as before; no new grant or signup/reset mail allowance. `translation
  allowance and money cap are independent`: test trial limit 2 items accepts 2,
  refuses 3 with `limit_reached,fits:2`, provider calls 0 on refusal; full limit 6
  after method addition still includes the 2 already used. Set existing policy
  cap `5000000`, old spend `4998978`: preserve the original exact-fit admission
  test and refuse one extra even when E allowance has room. Reverse the constraints
  and prove E refuses while safety cap has room. `translation lease and failure
  cannot refund or replay a call`: held 2/unstarted expiry releases to 0; first
  call spends 2 once, actual cost e.g. `7` stays `7` through lease takeover,
  cancellation and callback failure; calls remain 1 where the original callback
  contract forbids retry. Preserve cancellation-after-response accounting order,
  failed billed responses, retained usage, partly_done, result replay/collect/
  release, foreign-job-before-cursor checks and D's post-wait refusal. Old lease
  cannot spend/release; uncertain crash before response retains debit and creates
  no extra allowance on resume. `month and method transitions do not refill`:
  start 30 November, finish 1 December, debit stays November; a new December job
  uses December, while safety cap still follows its existing created_at month.
  Disabled/existing/test-free-paid paths produce identical old responses and no
  E rows; invalid options/production binding refuse before listeners/provider work.

  `translation uses the exact consent owner`: A and B both own an organisation;
  A's consent binds admission to A although the proof names only installation/
  venue. B cannot substitute. Disable/remove A or withdraw/replace consent while
  admission waits: zero reservations/provider calls. Exact authorised job replay
  keeps the original actor/ID with zero new debits. `uncertain pre-call work is not
  confirmed trial use`: pause after spent commits but before provider invocation,
  crash the worker, then assert units 2/spent, calls 0, translationRuns 0 and
  complete false. A real call whose callback cannot commit also remains unavailable
  without replay. Filter confirmed starts by their saved invocation instant at
  trial start/last included day/end; a reply after midnight cannot move the run.

  Pin the principal results in those named cases with these assertions (fixture
  variables are actual stored totals/results, not replacement implementations):
  ```ts
  assert.deepEqual([admitted,refused,accountUsed],[1,1,2n]);
  assert.deepEqual([afterLostAck,afterReplay],[35n,35n]);
  assert.deepEqual([probeDays,twoDays,threeDays],[0,2,3]);
  assert.deepEqual([uncertain.complete,uncertain.usage.translationRuns],[false,0]);
  assert.deepEqual([afterCancel.units,afterCancel.state,recordedCost],['2','spent','7']);
  assert.deepEqual([deniedProviderCalls,staleLeaseCalls],[0,0]);
  ```
  Keep the account/traffic assertions in E2/E4's owning named tests; this block
  fixes their exact values without moving unrelated tests into E5.
- [ ] **Step 2: Observe named DB/real relay RED in actual CI**, test-only signed
  commits first: `pnpm --dir packages/registration exec node --test --test-timeout=30000 test/billing-allowance-relay.test.ts`;
  `pnpm --dir packages/translation exec node --test --test-timeout=30000 test/billing-allowance-translation.test.ts`;
  `pnpm --dir packages/account-http exec node --test --test-timeout=30000 test/billing-allowance-runtime.test.ts`.
  Native only: `node --test deploy/test-cloud/allowance-runtime.test.mjs`.
- [ ] **Step 3: Implement admission and lifecycle integration.** Relay keeps
  its legacy policy as an additional independent ceiling, not a substitute;
  account+venue monthly reservation and retained message debit commit together.
  Handoff/status/cancel only replay the saved reservation, never select a fresh
  month. Translation reserves in createJob's transaction after bound replay,
  permission, consent/readiness and existing estimate checks. Bind reservation to
  job/operation fingerprint. First provider attempt spends it under current lease;
  conservative pre-call crash debit stays spent. Prove unstarted status under job
  lock before release in sweep/terminal failure paths; never reclaim a live lease
  merely because its time elapsed. A stale worker's beforeProvider returns false.
  Preserve `spent` then `attempted` callbacks even on abort/billed failure, the
  existing cost rounding/ledger and independent cap. Do not replay a paid call
  because allowance/accounting/guard storage failed. Do not alter `monthSpend`
  semantics, job retention or cost records. Record `recordAllowanceAttempt` from
  the existing attempted callback under the current job lease, alongside its
  lease update, passing the call-start instant captured immediately before actual
  respond invocation, never callback completion time. Once observed it remains
  historical. An uncertain pre-call debit
  stays incomplete for trial usage until an actual callback exists; do not replay
  a call to manufacture that evidence. SMS/rota/address
  remain future adapters only; no invocation or provider is added.
- [ ] **Step 4: Require new and original relay/translation/security suites GREEN
  in CI on this head**, including relay bounds/control/worker, translation
  machine/job-store/worker/batch-runner/retention and D permission regressions.
  Run E1/E3/pure runtime and types locally. Inspect all mode defaults explicitly;
  no checked-in env/Compose enablement or live mail.
- [ ] **Step 5: Commit:** `git commit -s -m "feat: enforce test monthly allowances at existing service admissions"`.

### Task E6: Qualify migrations, recovery and independent omission controls

**Files:** Create `scripts/{allowance-traffic-guard-probes,allowance-traffic-guard-probes.test,schema-upgrade-allowance-fixture}.mjs`,
`packages/registration/test/{billing-allowance-guards,billing-allowance-upgrade-recovery}.test.ts`.
Modify `scripts/{schema-upgrade-fixture,schema-upgrade-fixture.test,schema-upgrade-receipt,verify-schema-upgrade-receipt,verify-schema-upgrade-receipt.test,database-recovery-migrations.test}.mjs`
and registration `test/fixtures/migration-release.ts` after slot/proof coordination.
Docs: `docs/usage-metering.md`, `packages/registration/README.md` and only E's own
billing backlog paragraph at finish. No campaign instructions in the repository.

**Interfaces:** Guard runner `--pure|--database`, strict per-case baseline/fault/
restored receipts. Fixture exports
`seedAllowances(root:string,pool:Pool,state:object):Promise<object>`,
`allowanceState(pool:Pool):Promise<object>` and
`restoredAllowances(root:string,pool:Pool,proof:object,expected:object):Promise<void>`;
objects are private synthetic proof state. Extend `upgradeRevisions` with mutually
exclusive `--allowances --old <full-predecessor> --new <full-candidate>`.
Reserve schema receipt **version 8** for E (D proposes 7); if occupied, coordinate
a new version, never reinterpret 1–7. Require exact recorded predecessor/new
manifest counts and driver/new equal clean candidate head.

- [ ] **Step 1: Write harness/verifier and actual migration RED before proof code.**
  Native: `node --test scripts/allowance-traffic-guard-probes.test.mjs scripts/schema-upgrade-fixture.test.mjs scripts/verify-schema-upgrade-receipt.test.mjs scripts/database-recovery-migrations.test.mjs`.
  Zero/skipped cases, setup errors, timeouts, zero/multiple mutation matches and
  deliberately undetected negative-control faults reject qualification. Missing/
  false/string/extra receipt facts, wrong head/count/digest, equal pins, dirty
  driver and nonzero cleanup reject. CI wrappers named `allowance guards detect
  independent omissions` (240-second bound) and `allowance exact head upgrade and
  recovery is qualified` (360-second bound) must execute actual new-schema RED,
  not only validators, before E2 SQL/proof implementation.
- [ ] **Step 2: Implement omission controls in disposable complete copies only.**
  For every row below independently omit exactly one guard, see its named test
  fail for the specified wrong value, restore original bytes and require GREEN.
  Pure controls run natively; DB/relay/gateway controls run only in actual CI.

| Separate omission | Behavioral assertion that must detect it |
| --- | --- |
| Trial-active interval test; method test (two faults) | E1 expired trial incorrectly selects `2n` instead of `0n`; paid-method trial selects `2n` instead of `6n`. |
| Account bucket serialization | E2 last-unit race admits 2 instead of 1. |
| Composite/account ownership check | E2 foreign owner obtains a reservation instead of refusal and zero rows. |
| Original reservation replay comparison | E2 changed binding is accepted instead of conflict, or rollover makes a second debit. |
| Never-attempted release guard | E5 spent 2 becomes 0 after release instead of remaining 2. |
| Independent money cap admission | E5 extra item at cap is admitted instead of original limit refusal. |
| Current job-lease check before provider | E5 stale lease makes a call instead of calls 0. |
| Traffic signature check; final reporter binding (two faults) | E4 forged envelope or old-generation new report adds an event instead of 0. |
| Traffic sequence/payload replay check | E4 lost-ack replay adds 35 more or changed payload succeeds instead of total 35/conflict. |
| Operational-backend exclusion | E4 positive three-day probes produce 3 trial days instead of 0. |
| Counter decrease/overflow rejection | E3 reset/wrap produces bytes instead of refusal and incomplete coverage. |
| Completeness gate for trial usage | E4 silence/time hole/unclosed predecessor becomes complete/unused instead of unavailable. |
| Confirmed-attempt distinction | E5 spent debit with calls 0 becomes a confirmed run instead of incomplete/0. |
| Exact consent-actor binding | E5 selects B for A's consent or admits after A loses authority instead of refusing. |

- [ ] **Step 3: Implement and run the coordinated stopped-consumer upgrade/recovery.**
  In E2's **test-only prerequisite** commit, update only current total/tail checks
  in registration `test/{registration,schema-compatibility,backup-verification-migration,forward-observations-migration}.test.ts`
  and translation `test/result-storage-upgrade.test.ts`. Preserve every historical
  prefix/index/digest/row assertion and old SQL, including 038 and 045. Add the
  exact real predecessor release to `migrationRelease`; do not fake a truncated
  current migrate function. `hasReleaseMigrationCount` stays manifest driven.
  Current release rejects the old count and missing/changed/future ledgers.

  The delivered `billing-upgrade-recovery.test.ts` currently runs v6 against HEAD,
  but v6 requires 44→45. Before E adds a migration, preserve its original test
  and assertion bodies by invoking them in an installed clean owned checkout at
  `3d3c3def00bf27d60f2d97f5c23cd4acc1aebf7d` (old full
  `1a3e43e885edfbe9932c835e3f4fb8929718b2dc`, counts 44/45), as D6 plans.
  If D implements that prerequisite first, reuse it; do not repeat or undo it.
  If D's v7 HEAD wrapper lands before E, pin its original proof invocation to
  the exact delivered D release/counts before E adds its next migration. Keep
  v7 assertions there and add E's v8 current-head replacement; do not let a
  historical verifier accept arbitrary newer schemas. Agree these invocation
  hunks with D before editing them. No weakening historical recovery checks.

  Name migration cases `allowance upgrade preserves every prior ledger row` and
  `interrupted allowance migration rolls back and retries once`. Use actual old
  migrate/SQL, stopped consumers, concurrent/repeated migration and owned-backend
  termination while ledger insertion is blocked. Assert prior rows/digests/
  applied_at unchanged, new tables absent on interruption, exactly one new ledger
  entry after retry and empty unenabled E state after old-backup upgrade. New
  consumer refuses old/interrupted schema; old consumer refuses the new schema.
  New current consumer starts only with complete exact ledger.

  Extend the existing proof, retaining its common identity/account/relay/monitoring/
  backup/key/hold checks. v8 `allowances` has exactly these true fields:
  `oldSqlUnchanged`, `oldRowsPreserved`, `interruptedRollback`, `restartIdempotent`,
  `defaultOff`, `configRestored`, `reservationsRestored`, `spentNotReleased`,
  `trafficSourcesRestored`, `trafficLedgerRestored`, `trafficRetryStable`,
  `gapsRemainIncomplete`, `foreignScopeRefused`, `oldBackupUpgradeEmpty`.
  Create separate pre-upgrade and populated-new logical backups. Restore each to
  another owned DB with matching external synthetic keys/spool state; use
  `pg_restore --exit-on-error` and preserve schema search paths in nested SQL
  helpers. Restore held/spent/released reservations, config revisions, reporter/
  process identity, accepted reports/gaps, exact traffic ledger and trial facts.
  Replay pending spool after DB restore without duplicate bytes; stale checkpoint
  against newer DB must recover by exact replay or refuse, never reset identity.
  Wrong/missing keys refuse; preserved backups/holds and upgraded DB remain intact.
  No backwards migration, history pruning, live recovery or retention claim.
- [ ] **Step 4: Require exact-head CI GREEN and inspect execution receipts.**
  `pnpm --dir packages/registration exec node --test --test-timeout=240000 test/billing-allowance-guards.test.ts`;
  `pnpm --dir packages/registration exec node --test --test-timeout=360000 test/billing-allowance-upgrade-recovery.test.ts`.
  Their existing `test/*.test.ts` discovery must run harness controls, all 16
  independent omissions/restorations and the actual two-backup recovery. E4's
  discovered remote wrapper must run actual HAProxy proof. Ordinary tests keep
  30 seconds; wrappers fit the actual eight-minute package job. Inspect counts,
  coverage, receipts and selection; omitted suites, conditional skips, prior-head
  evidence, setup-only RED or exhausted budget block readiness and go to driver
  coordination, never CI edits to conceal them. While Docker is down, run only
  E1/E3, pure runtime/fixture/verifier controls and `pnpm typecheck` locally.
  No local Docker, `scripts/test-postgres.mjs`, `pnpm test` or blanket workspace
  suite. Record each test-only RED head/job/assertion and implementation-head GREEN.
- [ ] **Step 5: Commit and complete the authorised branch lifecycle through the driver.**
  `git commit -s -m "test: qualify allowance guards traffic replay and recovery"`.
  Announce readiness for `finish-branch`. After initial rebase, run one full
  candidate Claude run-it review via `claude-seat.sh review-run` in a complete
  installed throwaway checkout, triage/fix findings in the feature tree, use normal
  hooks and signed-off commits, and requalify each changed head. A later rebase
  alone retains that review. Require every current-head selected CI job final/
  green: selection, documentation/scripts, root 1–4, types, actual package shards,
  receipts, strict summary and every actual cloud-cost job. Audit justified
  reuse/skip evidence rather than trusting the summary. Compare actual backlog
  three-way merges with **every** active/parked branch and preserve others' hunks.
  Under shared `~/waitron-campaign-shared/main.lock`, fetch/read fresh main and run
  `git merge-base --is-ancestor <fresh-main> <qualified-head>` immediately before
  authorised `land-branch`; rebase/requalify if false. Perform normal main install
  and only owned branch/worktree/environment/process cleanup. Independently audit
  all main jobs at the exact merge SHA to final green. No live enablement.

E1/E2 cover design §3's sizes-as-configuration, monthly refusal and account/venue
scope; E1/E5 cover §4's active unpaid-method tier without losing the safety cap;
E3/E4 cover §3's traffic unit and §4's three distinct actual-use days. E2/E6 keep
§10's country ownership and recoverability. SMS/rota/address runtime, owner sizes,
production calendar/network qualification, legal retention, G's trial decisions,
J's unaccepted shared display and live enforcement remain explicitly unbuilt.
