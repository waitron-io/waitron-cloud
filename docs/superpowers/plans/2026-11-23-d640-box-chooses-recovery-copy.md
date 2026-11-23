# D640 · Choose the recovery copy on the box

“Why? it would be much friendlier to do it from the box” (owner, as quoted by
Lane A’s watcher on 23 November at 19:00 and in D640’s queue). Cloud approves
snapshot recovery for the venue. The box lists checked copies, defaults to the
newest and binds recovery to the choice made on the box. Wait for Lane A’s wire agreement
in `questions.md` and watcher clearance before building. Verify the Cloud and PR 6e
candidates together in an isolated test before releasing the new portal to its boxes.

- [ ] Add `packages/registration/migrations/084_venue_snapshot_recovery.sql` and register
  it in `src/migrate.ts`. Replace migration 018’s source constraint to allow an
  unselected snapshot operation, with nullable `selection_open` distinguishing old rows
  and recording first-read admission. Retain migration 043’s point-to-verification check.
- [ ] Extend `packages/backups/src/{recovery,recovery-request,catalogue}.ts`. Authenticate
  `points` and `select` against the key and target on the version-2 request. Lock that
  request before account, membership, policy and venue checks. Retain owner proof,
  test-venue and plan checks, audit, expiry and the one-active-operation rule. Reauthorise
  the stored venue and choice without extending the deadline. Keep explicit point-ID
  approvals for the existing rehearsal caller and continuous-generation renewals.
- [ ] Extend the signing helper in `packages/backups/src/recovery-v2.ts` and the validator
  in `recovery.ts`. Add `points` (empty signed value) and `select` (point ID) in
  `packages/account-http/src/recovery.ts` at `info` limits. Map `approval_required` and
  `selection_required` to 409. Before selection, use the request target and an empty
  value to authenticate `info` or `read`. Refuse unselected `restored`.
- [ ] Share the list and selection query. Filter the approved venue’s snapshots for
  current verification of the exact request target and exclude deleting and deleted
  copies. Sort capture time and ID descending. Send at most 50 existing `info` point
  objects in a newest-first prefix within 65,536 bytes of whole JSON. Recheck eligibility
  at selection. Use saved-session proof as on `read`. Save the point, target and attempt
  under the existing locks. Freeze the choice on the first admitted database read before
  a storage grant, or on accepted `restored`. Keep same-choice retries, archive-digest
  proofs and post-grant checks.
- [ ] In `apps/portal/src/{app,backup-controller,backup-screen,recovery-screen,recovery-controller,recovery-types,locale}.ts`,
  keep venue, continuous choice and both confirmations. Replace the snapshot picker and
  timestamp with an English and Spanish loss line about the later choice on the box.
  Handle pending snapshot approval without a point and renew by the stored binding.
- [ ] Run focused tests red then green. `packages/backups/test/recovery-v2.test.ts` owns
  eligibility, retention between list and select, preselection and the read/select race.
  `packages/account-http/test/recovery-v2.test.ts` owns signed routing, refusal statuses
  and credential delivery. Check old rows in `packages/registration/test/backup-verification-migration.test.ts`.
  Advance migration pins. Run `recovery.test.ts` in backups and `recovery-qualification.test.ts`
  in backups and account-http. Update affected portal tests starting with
  `recovery-select-browser.test.ts`. Check Account with `backup-browser.test.ts` and look
  at both languages and themes at 390 and 1280 pixels.

Document the signed replies, refreshing the list when a copy disappears, and owner steps
in `docs/local-backups.md`, with the integration link, account HTTP README and backlog.
Scope is test snapshots. Expected size is 260–360 code lines and 250–350 test lines.
