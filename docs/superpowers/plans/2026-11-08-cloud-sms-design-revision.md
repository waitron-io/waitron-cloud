# D610: Short SMS design revision for draft #1093

**Scope:** Revise documentation only. The parent obtains Claude's plan read and
watcher approval before making the revision. No implementation is authorised.
Use Lane G's 8 November notes at 10:55, 10:58, 11:11 and 11:16; the last two replace earlier purposes and paid-only availability.

## What changes

- Choose GatewayAPI. Password alone signs in; a passkey can also sign in alone.
  SMS only confirms an added phone or supplies strongest proof on an SMS-only account.
  Never offer SMS-only login or invent venue staff sign-in purposes.
- Every Cloud plan includes SMS. State and count both uses per account each month:
  free 10, first paid 25. Initially unenforced, with configurable figures and switchable enforcement. Leave higher-tier numbers unchosen.
  Make SMS's initial non-enforcement explicit beside billing's general refusal rule.
- Propose a minimum 60-second resend wait and at most five guesses per challenge
  and session, enforced from day one. Resending does not reset the session cap.
- Cloud stores fixed templates. Requests name a template and supply variables;
  reject free text and values outside checked types and lengths (digit codes, valid times).
  Record the owner's 8 November fixed-template rule for every venue email and SMS; leave email code alone.
- Booking reminders have no default SMS; any future offer needs guest opt-in.
  Remove extra-paid-booking machinery, provider survey, WhatsApp and AWS-specific onboarding; design no booking product or price.
- Retain concise safety boundaries: authorised account/venue requests, checked
  recipients, bounded messages, refusal of expired codes, no sensitive logs, no duplicate uncertain sends,
  and provider/privacy/sender qualification before enablement. Refresh retained external claims against official public sources during revision, not planning.

## Files and size

Only these five files may change in the full candidate:

- `docs/superpowers/plans/2026-11-08-cloud-sms-design-revision.md` (this plan).
- `docs/superpowers/specs/2026-11-07-cloud-venue-sms-gateway-design.md` (short design).
- `docs/superpowers/specs/2026-10-29-cloud-billing-design.md` (SMS allowances and existing allowance-slot wording/cross-reference).
- `docs/backlog/free-services.md` (SMS paragraph only).
- `docs/backlog.md` (own SMS index text and fixed-template decision only).

Estimate: zero production-code lines, zero test-code lines; about 140 changed documentation lines, additions plus deletions, including this plan and current branch changes.
No other backlog bytes, new mechanism or extra approval steps. No accounts, senders, spending, sending or enablement. Recovery and handover choices stay open.
D608/#1090 is separate: its current spec still requires extra sign-in proofs,
mailbox-plus-proof reset and separate SMS capacity, and describes AWS onboarding.
Parent reports these mismatches in progress.log; its separately authorised revision reconciles 11:16. Do not copy or edit that spec in #1093.

## Checks and finish line

After revision, inspect the full candidate diff and links for consistent purposes,
figures and boundaries; verify only the listed files and permitted backlog text changed.
Use signed-off commits (`git commit -s`), then run the existing immutable document
check (`node scripts/ci-docs.mjs`) with the planner's exact committed base/head/paths,
`node --test scripts/ci-docs.test.mjs` and `git diff --check`; no broad suites. Have Claude read the revised design before returning it to the watcher.
Finish: owner can review a short, consistent SMS design in existing draft #1093;
no design landing or build until the owner approves.
