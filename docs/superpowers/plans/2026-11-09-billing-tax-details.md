# D604 slice F: synthetic billing tax details

**Outcome:** an allowlisted synthetic owner can enter, read and correct a business’s legal name, address and tax number on Account. This is synthetic entry only, under the approved [billing design §§5,9](../specs/2026-10-29-cloud-billing-design.md) and [parent row F](2026-10-29-cloud-billing.md#the-slices-in-order). Lane G’s D604 queue explicitly asks for “portal pages to choose a level, give tax details”. Watcher 9 November 20:08 cleared this plan. Watcher 17 November 16:06 resumes its tax and account pages in test mode; only starting hosting remains behind D113 executor qualification. No owner approval of this plan is claimed.

**Limits:** no paid access, charges, invoices, prices, providers, Waitron/fiscal/location changes, history, ledger, dependency or production eligibility. Paid-level collection and Spanish tax-number validation remain open in `docs/backlog.md`; syntax checks establish no legal identity.

**Shape:** reuse `legal_businesses.name`; preserve `country_code`. Existing name readers are registration `pairing.ts:36,81`, HTTP `venue-overview.ts:13`, backups `replacement.ts:27`. Append nullable `billing_address` and `tax_number`. Save trimmed strings atomically, rejecting controls, extra keys and empty values. Use signup’s JavaScript string-length limits: name200, address600, taxNumber32. Use single-line `wt-input` controls. Reads accept historical `string|null` values without applying input restrictions.

**Files** (R=`packages/registration`, H=`packages/account-http`, P=`apps/portal`; braces expand literally):

- R `migrations/069_billing_tax_details.sql`, `src/migrate.ts`, `test/{registration,schema-compatibility,billing-migration,venue-service-migration,backup-verification-migration,forward-observations-migration,billing-allowance-migration,ses-feedback-migration,mail-handoff-migration,mail-suppression-migration,staff-problem-reports,fiscal-registry-schema}.test.ts`, `test/fixtures/allowance-schema.ts`.
- `packages/translation/test/result-storage-upgrade.test.ts`, `scripts/schema-upgrade-receipt.mjs`.
- H `src/billing-account.ts`, `test/billing-account.test.ts`, new `test/billing-tax-details.test.ts`, `README.md`.
- P `src/{api,billing-types,billing-controller,billing-screen,locale}.ts`, `test/{billing-api,billing-account-fencing}.test.ts`, new `test/billing-tax-details-browser.test.ts`.
- `docs/backlog.md`, this page.

Use migration069, rechecking reservations before build. On 17 November main’s manifest ends068_owner_transfer.sql and `gh pr list --json number,title,headRefName` returns no open pull requests. This updates the original provisional056 without changing any landed migration. G’s worldwide console has its own schema and no registration migration. Never edit landed migrations.

**Test-first build, one PR:**

1. Add a populated-predecessor case to existing `billing-migration.test.ts`; observe RED, append the two columns/bounds, then GREEN. Preserve repeated/concurrent/interrupted migration assertions. Update current-count checks, retaining historical names/digests/data. For whole-row comparisons in billing, backup-verification, fiscal-registry and schema-upgrade receipts, project only the two new legal-business keys when absent before upgrade; separately assert NULL. Never alter fiscal rows or expected fiscal results. List changed checks in PR.
2. Add failing API cases, then optional `taxProfile:{legalName,address,taxNumber}` on `/billing/read`, independently of `methodsEnabled`; POST `/api/account/billing/tax/save {venueId,legalName,address,taxNumber}` returns the view. Omit/refuse profiles for businesses with any non-test venue. Keep allowlist, mode, origin, CSRF, verified-credential, membership and session checks. Lock account/session→credential→membership→organisation FOR SHARE→business FOR UPDATE; recheck venue binding and mixed environments after waits, resolveSession last. Test foreign/mixed businesses, malformed/bounded inputs, expiry/revocation and production-venue creation during waits, rollback and unchanged service/billing rows.
3. Add failing portal cases, then strict key/string-null validation and controller-owned drafts per venue. Clear on account loss/pagehide; loads preserve edited fields and refresh untouched fields. Preserve drafts on uncertain saves, refresh without replay;400 shows a specific correction message. Concurrent saves are last-write-wins. Fence late replies and retain existing assertions.

**Finish:** focused named PostgreSQL/API/portal/browser cases; real save/reload/correction; all eight English/Spanish × light/dark ×390/1280 views, keyboard/axe/overflow; typecheck/portal build. CI owns full suites: inspect every current-head job. The two Claude run-it reviews required for migrations and permission checks run during finish-branch, followed by one fixes read. The original pre-build plan read and watcher clearance are retained; watcher 17 November 16:06 authorises this resumed test-mode slice. Estimate750 touched lines: code250/20, tests390/40, config0/0, docs45/5 added/deleted; under3hours toPR.


**17 November build choices.** K reuses the existing billing-account test helpers in
that file instead of duplicating them in a new tax test file. The shared portal
fixture accepts the same optional billing configuration, so all eight visual cases
save/reload/correct through its actual HTTP server and PostgreSQL. Each case has
its own fixture after the shared one reached the unchanged per-IP rate limit.
The historical schema-upgrade receipt driver still checks specific old release
lengths (up to 51, `scripts/schema-upgrade-receipt.mjs:202`); it cannot run the new
69-migration candidate and is not widened here. The new populated-068 migration
case owns this upgrade. Whole-row comparisons retain every old key and assert the
two new keys as null; all fiscal rows and expected fiscal results remain unchanged.

**Review correction:** store a per-venue draft only after an edit. Reconcile untouched fields against the previous server view, retaining edited fields, so two venues of one business cannot silently restore stale unedited values. This reuses the existing server view and draft map, with no new baseline record or API field.
