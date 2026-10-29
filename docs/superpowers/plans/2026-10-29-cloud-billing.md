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
including zero-cent ones. Do not recompute historical charges on reads or replays.

Persist a local pending attempt and its immutable method binding before F ever submits
it; C does not send or decide whether another attempt is due. Every observation appends
history tied to the current event. Provider-source events must match the attempt's
provider/account; only `observe_payment` accepts a provider event source. `expectedRevision:null` means history only; a numeric value asks to
accept with a compare-and-set on that revision. Permit pending-to-succeeded/failed,
failed-to-succeeded correction and succeeded-to-refunded acceptance, plus same-state
observations. Acceptance increments attempt revision; history-only writes leave it unchanged.
Never accept succeeded-to-pending/failed or any reversal of refunded.
Do not sort webhooks by timestamp or infer provider precedence. F validates authenticity
and decides which observation to propose for acceptance; G decides effects and retries.

On first accepted success, append paid periods for matching nonzero venue lines within
that same transaction; first success remains provable after refund. Connected periods
use renewalDate/connectedUntil; hosted periods use that venue's minimum assigned day
through one day after its maximum, without claiming connected coverage. History retains
exact hosted dates in the assigned day rows. No success changes the current venue level,
consumes the other level's trial, issues an invoice or starts service. Protect provider
bindings, first success and frozen amounts against direct SQL regression.

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
