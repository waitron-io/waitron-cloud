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
