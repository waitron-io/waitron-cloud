# D610: SMS design revision for draft #1093

**Documentation only; watcher approved this revision at 11:35 on 8 November, with the changes below.** Update the existing draft so the owner can review at most two pages of plain English. Build and landing remain unauthorised.

## Recorded decisions

Lane G questions.md records the watcher quoting the owner on 8 November:
- 10:55: “Gateway sounds good”; booking reminders are not SMS by default and require guest opt-in.
- 10:58: “SMS requests would follow a template on our server”; the watcher explicitly applies this to every venue email and SMS, with typed, length-limited values.
- 11:11: the owner chose stated, initially unenforced monthly limits; “count every send per account” and “make the limit a setting that can be switched on and raised” are watcher directions. 11:39 records the owner’s corrected levels: Registered (level 1, free) 10/month; Connected (level 2) 25/month; Hosted (level 3) includes level 2.
- 11:25 settled rules replace 11:16 and the hold: “email before SMS, it costs less”. The shared `sign-in-rules-20261108.md` limits SMS to phone confirmation and a second check chosen by the person. These are design decisions, not provider or build approval.

## Revision

- Choose GatewayAPI. Describe phone confirmation and optional second-check codes; email is the default fallback. Do not offer SMS-only sign-in or replace an enrolled app with SMS. Keep the full sign-in/recovery rules in D608's separate #1090 revision.
- Every plan includes SMS. State the owner’s Registered 10/Connected 25 monthly figures once in this spec, count per account; Hosted includes Connected. One send is one encoded message part; keep messages to one part. State that monthly enforcement is initially off and configurable.
- Propose 60 seconds between requests per phone number and purpose across accounts and browser sessions, and five wrong codes per sign-in attempt. The service checking the code enforces guesses; resending does not restart that attempt or its cap. 11:11 replaces the watcher’s 7 November 22:47 hourly/daily quota wording; introduce no new quota. State that the wait alone permits up to 1,440 texts per phone and purpose each day (about €49 at the prior price assumption), with no cap on phones per account.
- SMS in Waitron needs a venue connected to Cloud. Cloud owns fixed templates; callers send a template name and values. Refuse free text and any value outside that template’s allowed type and length (a code is digits; a time is a time). Add only the requested email-and-SMS template decision to the backlog; preserve bounded legitimate variables.
- Remove the paid-booking purchase design, provider survey, WhatsApp and AWS-specific onboarding. Booking messages of any kind are outside this gateway revision; a future offer requires guest opt-in.
- Retain current authority/consent checks, expiry refusals, stable retry identity, unknown-submission protection and no sensitive logs. If the provider’s answer is unknown, count it and do not resend; the person can request a new code after the wait. Cut paid-booking reservation/release text. Spanish recipients initially; qualify other countries separately. Provider privacy, sender eligibility and encoding remain unqualified before enablement. Keep factual detail only when needed; verify any retained external claim from official public sources.

## Files and size

Only these five files may change in the complete candidate:

- This plan: `docs/superpowers/plans/2026-11-08-cloud-sms-design-revision.md`.
- `docs/superpowers/specs/2026-11-07-cloud-venue-sms-gateway-design.md`: at most two pages, plain English.
- `docs/superpowers/specs/2026-10-29-cloud-billing-design.md`: SMS exception to account/venue counting in §2; references in non-goals, §3 and §11; both reached-allowance statements (§3/§14); preserve/update both SMS anchors. Link to the SMS figures rather than repeat them.
- `docs/backlog/free-services.md`: SMS paragraph becomes a short link to the spec.
- `docs/backlog.md`: only own SMS index text becomes a short link; add the fixed-template decision under Decisions and deliberate limits. Preserve every other byte.

Estimate: 0 production-code lines, 0 test-code lines, about 140 changed documentation lines including existing branch changes and this plan. GatewayAPI is chosen; this is not approval to open a provider account, spend or build. No sending, runtime mechanisms or new recovery/handover choices. Cross-check #1090 read-only; report mismatches in progress.log without copying its spec here.

## Checks and finish line

Inspect the complete diff, local links, purposes, counting exceptions and two-page/plain-English limit. Run immutable `node scripts/ci-docs.mjs` with the planner’s committed base/head/paths and `git diff --check`; retain the already passing 15-case `node --test scripts/ci-docs.test.mjs` result unless relevant inputs change. Use signed-off commits and a Claude read of the revised design, then update existing draft #1093. Finish: the owner can review a consistent SMS design. No implementation or landing until approved.
