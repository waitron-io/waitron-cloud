# D610: SMS design revision for draft #1093

**Documentation only; amended plan awaits watcher approval.** Change only this plan now. Parent reads and commits it, obtains exactly one Claude read, then asks the watcher for approval before revising the design. No implementation while approval is pending.

## Scope and provenance

Lane G `~/waitron-campaign-g/questions.md`, watcher **2026-11-08 12:12**, quotes OWNER: “from day one, at most 10 texts per account per day, and only to phone numbers in EU countries.” The second 12:12 note quotes “and a warning if somebody starts abusing these numbers” and directs operator alerts and account-owner email at the daily cap, unusual daily destination count and crossing the unenforced monthly figure, using Cloud’s existing alert route.

Replace earlier no-daily-quota/exposure and Spanish-only destination wording. Retain the 10:55 GatewayAPI choice, 10:58 fixed templates, 11:11 account counting/monthly enforcement off, 11:39 corrected levels, and settled `~/waitron-campaign-shared/sign-in-rules-20261108.md` (11:25: “email before SMS, it costs less”).

## Revision after approval

- State the daily cap and EU-only destinations from day one; propose a UTC calendar day. State monthly figures once in the SMS spec: Registered 10 and Connected 25 texts/account/month; Hosted includes Connected. Monthly enforcement stays off and configurable. Remove uncapped exposure calculations. Keep provider-specific EU number classification and enablement evidence open; a country prefix does not establish residence.
- Describe operator alerts through the existing Cloud route plus account-owner email at each of the three triggers above. **Draft proposal:** three distinct destination phones/account/day, warning on the fourth; no hard phone-count cap. **Proposed email, not owner wording:** “Your SMS use reached a warning level. Check your account’s SMS activity.”
- Keep GatewayAPI and two code purposes: phone confirmation and an opt-in SMS second check, email default. No SMS-only sign-in or replacing an enrolled app. Broader sign-in/recovery rules stay in D608’s separate #1090 revision; cross-check read-only.
- Keep fixed Cloud templates, typed/length-limited values, free-text refusal, one encoded part, and Waitron’s connected-venue requirement. Count every send per account, including unknown provider answers; unchanged retries retain identity/count, pre-submission refusals count zero. Unknown answer: count it, no automatic resend. Retain authority/consent checks, expiry refusals and no sensitive logs.
- Keep 60 seconds per phone and purpose across accounts/browser sessions and five wrong guesses/sign-in, enforced by the code checker; resend cannot reset guesses. **Owner questions remain:** mixed-level account monthly figure (replacement versus addition included), phone-confirmation guesses and recipient consent for an unproven phone. Decide none here.

## Files, exclusions and estimates

Only these five files may change in the complete candidate:

- This plan: `docs/superpowers/plans/2026-11-08-cloud-sms-design-revision.md`.
- `docs/superpowers/specs/2026-11-07-cloud-venue-sms-gateway-design.md`: at most two plain-English pages.
- `docs/superpowers/specs/2026-10-29-cloud-billing-design.md`: SMS account-counting exception (§2), references in non-goals/§§3/11, both reached-allowance statements (§§3/14); preserve both SMS anchors.
- `docs/backlog/free-services.md`: short SMS link.
- `docs/backlog.md`: own SMS/decision lines only, including fixed templates for venue email and SMS; preserve everything else.

Use short links elsewhere; do not repeat figures. Existing committed candidate: 103 changed documentation lines against main’s common base (`git diff main...HEAD --shortstat`); estimate 150 total after this slice, no more than needed. **Production code: 0 lines. Tests: 0 lines.** Exclude bookings, paid-booking mechanisms, provider surveys, WhatsApp, AWS onboarding, new ledgers/records, deadlines or approval systems. Privacy, sender eligibility, encoding and delivery qualification remain open.

## Checks and finish line

Check complete diff, links, counting exceptions, retained safeguards, removed contradictions and page limits; run `git diff --check`. After parent commits the approved documentation revision, run immutable `node scripts/ci-docs.mjs` with the planner’s saved base/head/paths. No code or tests run for this amendment. Claude must read the revised design before updating existing draft #1093; no second PR.

Finish: owner reviews a consistent capped SMS design and proposed alert wording; no sending, provider account/spending/build or landing authority.
