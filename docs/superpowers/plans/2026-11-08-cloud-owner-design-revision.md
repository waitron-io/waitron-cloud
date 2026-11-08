# D608: revise the Cloud owner design

Goal: give the owner one consistent lifecycle/sign-in design to review in draft #1090. Documentation only; nothing built or landed without authority.

Files: this plan; `docs/superpowers/specs/2026-11-07-cloud-single-owner-lifecycle-design.md` (plain-English rewrite, at most two pages); `docs/backlog.md` launch item 5 paragraph only. Estimate 110 documentation lines total, including existing branch changes; zero production-code/test-code lines. No other files, provider calls or implementation.

Approval provenance (carry these quotes and dates into the revised candidate):
- Lane G `RUNNER.md` §0, owner 2026-11-08: “Plan, then approval, then build.” Parent signs off this plan, obtains Claude's read, triages findings and gets watcher approval before revision.
- `~/waitron-campaign-g/questions.md`, watcher 2026-11-08 11:25: “Revise #1090 to it.” The full `~/waitron-campaign-shared/sign-in-rules-20261108.md`, owner 11:25 (“email before SMS, it costs less”), supersedes 11:16 sign-in and the subsequent hold (headed 11:22; called 11:20 in the 11:25 note).
- Same questions, watcher 11:11: “stated but not enforced at first”; “count every send per account”. Watcher 11:25 keeps SMS limits and fixed templates; 10:58 quotes the owner: “SMS requests would follow a template on our server”.
- Current lifecycle spec records watcher 2026-11-07 21:54: “accepted this combination for this work, subject to the owner's right to overrule” (mailbox plus paired-box administrator). Watcher 2026-11-08 11:25 explicitly leaves “one box recovering every organisation” open; do not present that consequence as accepted.

After approval, revise only settled decisions:
- Passkey alone signs in with user verification. Preserve browser passkey offers and “Remember me” preference without revealing whether an email has an account or passkey.
- With an app enrolled, password plus app code every time. Password instead of passkey needs the app if enrolled, otherwise email code; SMS only when chosen. Optional SMS never replaces an enrolled app.
- Password-only accounts use password alone on a familiar device/browser; a new one needs email code (SMS if chosen), then is remembered. Do not invent recognition mechanisms or expiry numbers.
- Include the off-by-default administrator setting requiring everyone to enrol an app or passkey, without inventing who may control it. Cloud owners must enrol an app/passkey before box connection; SMS does not satisfy that requirement.
- Ask for proof again for handover, password/email/proof changes, backup download/restore, payment methods, box connection and remote access. Follow the settled proof rule: passkey, app code, or email code for password-only accounts, with chosen SMS where allowed; no weaker route around enrolled proofs.
- A mailbox link resets only the password, preserves enrolled proofs, and leaves the next login subject to those proofs. Remove obsolete mailbox-plus-factor ordinary-reset wording and password-alone-for-everyone claims.
- Keep mailbox plus currently paired-box local administrator recovery: exact account/venue/organisation/country/request bindings, single use, completion rechecks, lost-proof/session invalidation, fresh enrolment and notification. Recovery of every organisation via one box, mailbox-and-box loss/staff manual checks and recovery codes across proof types remain pending. Add no support override or identity service.
- Keep recipient verification, fresh proof, account-only signup, explicit acceptance, atomic sole-owner replacement and immediate former-owner revocation, without later sender confirmation. Bind expiring single-use transfers to exact parties, organisation, country and owner revision. Preserve unfinished-transfer safety, checks after waits, competing outcomes, safe retries and private-result checks. Handover defaults, cancellation policy and expiry duration stay pending.
- Keep accounts, credentials, recovery and customer data country-local; two countries mean two accounts, no global dependency/export. Revoke former-owner sessions, approvals, support grants, consent and queued work derived from ownership; renew consent. Preserve unrelated organisations, independently authorised machine services, recovery/replacement coordination and separate Waitron staff, support, operator, fiscal and activation powers. Taxpayer identity stays unchanged; a different taxpayer needs separate Waitron handling. No second owner, invitations or managers.
- Keep generic replies, attempt limits and notifications; no account-existence disclosure in sign-in, recovery or handover.

SMS boundary and links:
- State only phone-number confirmation and chosen second checks, every send counted, free 10/first-paid 25 monthly stated but initially unenforced, day-one resend/guess limits and fixed Cloud templates. D610 owns GatewayAPI, delivery and allowance detail; remove provider pricing, surveys and AWS onboarding here.
- D610's plan still awaits approval: its proposed 60 seconds/five guesses are not approved D608 values. Do not choose numbers here.
- Name future `docs/superpowers/specs/2026-11-07-cloud-venue-sms-gateway-design.md` as code text while absent; link relatively once present in the reviewed tree. No copied branch files or broken links. Inspect actual link/CI failures; being behind alone does not justify rebasing unrelated historical code.

Checks and finish (parent, after revision):
- Rewrite only launch item 5: settled rules, accepted mailbox/box path, pending choices, “nothing built”; remove stale approvals.
- Read full merge-base-to-head diff and distinguish origin/main drift; count all changed lines/words, including existing changes. Check page limits, local links/anchors and `git diff --check`.
- Run `node --test scripts/ci-docs.test.mjs`; record counts. Use `git commit -s`; run `node scripts/ci-docs.mjs` with `CI_PLAN` containing committed planner `documentation.base`, `head`, exact `paths`. Read immutable-input evidence.
- Obtain final Claude design read, triage within approved scope, update existing draft #1090 with provenance/choices/checks. Read every current-head CI job and justify skips. No implementation or landing authority follows.

Finish line: the owner can review a consistent lifecycle/sign-in design with the remaining product choices plainly open.
