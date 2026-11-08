# D608: revise the Cloud owner design

**Documentation only; awaiting watcher approval.** Revise draft #1090 to the settled sign-in rules. No implementation, provider access or landing.

## Direction and scope

Lane G watcher 2026-11-08 11:25: “Revise #1090 to it”, the shared `sign-in-rules-20261108.md`, owner 11:25 (“email before SMS, it costs less”). This replaces earlier sign-in/reset rules. Watcher 7 November 21:54 accepted mailbox-plus-box recovery, subject to owner overrule. Watcher 11:25 leaves manual staff checks, recovery codes, handover defaults and one box recovering every organisation open.

Owner 11:39 settled Registered (level 1, free) 10 texts/account/month, Connected (level 2) 25, Hosted (level 3) includes Connected; stated, initially unenforced. Counting/configurability are watcher 11:11 directions; D610 owns delivery detail. No build authority.

## Revision after approval

- Include passkey alone with user verification, browser passkey offers and the “Remember me” passkey preference. Reveal neither account nor passkey existence.
- App enrolled: password plus app code every time. Preserve existing single-use app recovery-code use; extending codes to other proofs remains pending. Password instead of passkey: app if enrolled, otherwise email code or chosen SMS. SMS never bypasses an enrolled app.
- Password-only: familiar device/browser uses password alone; a new one needs email code or chosen SMS, then is remembered. Distinguish device recognition from passkey preference; choose no mechanism or expiry.
- Include the off-by-default administrator setting requiring an app/passkey for everyone. Keep enrolment before box, remote-access and payment actions; connecting a box requires app/passkey, including an existing owner and a recipient inheriting a connected organisation. Keep start/completion checks after waits; obtain clarification before removing existing requirements.
- Ask for proof again for handover, password/email/proof changes, backup download/restore, payment methods, box connection and remote access: passkey, app code, or email code for password-only accounts, with chosen SMS where permitted. State that mailbox control supplies reset and email checks for password-only accounts, without bypassing enrolled app/passkey requirements.
- A mailbox link resets only the password; proofs remain and next sign-in follows them. Preserve ending sessions and cancelling pending enrolments/challenges. Leave reset effects on remembered devices open. Email/SMS codes expire, work once and are bound to one sign-in/action with limited requests/guesses; choose no new numbers.
- Preserve mailbox-plus-currently-paired-box administrator recovery, exact account/venue/country/request and current ownership checks, single use, fresh enrolment, lost-proof/session invalidation and notification. Bindings establish authority, not recovery scope. No manual override is designed; total-loss recovery remains open.
- Preserve the current handover safeguards: verified recipient, account-only signup, fresh proof, explicit acceptance, atomic sole-owner replacement, immediate revocation, unfinished-transfer safety, after-wait checks, competing outcomes and private retry results. Keep country-local authority, independent machine permissions, unrelated organisations, consent renewal and recovery/replacement coordination. Ownership grants no staff, support, operator, fiscal or activation powers; taxpayer identity stays unchanged.
- Replace old code commentary/AWS research with unbuilt-checks status and a D610 reference. SMS confirms phones or supplies chosen second checks; fixed Cloud templates, account-counted figures and initially unenforced monthly limits follow D610, replacing the earlier separate security/booking capacity proposal. No new identity service.

## Files, checks and finish

Only this plan, `docs/superpowers/specs/2026-11-07-cloud-single-owner-lifecycle-design.md` and launch item 5 in `docs/backlog.md`. Estimate 110 changed documentation lines including existing branch edits; zero production/test code. Spec: at most two pages, target 1,000 words. Keep unrelated backlog bytes. Put approval quotations in the PR, with a short dated provenance sentence in the spec.

Check full diff, size, local links/anchors and `git diff --check`; name absent D610 as code text. Run `node --test scripts/ci-docs.test.mjs`, signed commits and immutable `node scripts/ci-docs.mjs` on committed planner base/head/paths. Obtain Claude design read; update draft #1090 and read current-head CI. Finish: owner reviews consistent rules and open choices; nothing built or landed.
