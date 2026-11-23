# D640 · Choose the recovery copy on the box

“Why? it would be much friendlier to do it from the box” (owner, quoted in Lane A’s
19:00 note and the D640 queue, 23 November). Cloud approves snapshot recovery for
the venue. The box lists its checked copies newest first and binds recovery to the
copy chosen there. Claude reviewed the plan. The watcher cleared the split at
21:27 and Lane A confirmed the request format at 21:32 in Lane G’s questions.md.

## PR 1 · Cloud server

- In `packages/registration`, register migration 084. The source check allows
  an approved snapshot without a selected point. Keep migration 043’s verification
  check. Existing rows retain null `selection_open` and their existing binding.
  A new approval naming a point starts with that copy selected and
  `selection_open=true`. An approval naming only the venue starts open without a copy.
- In `packages/backups/src/{recovery,recovery-request,recovery-v2,catalogue}.ts`,
  keep owner proof, venue authority, test scope, plan checks, audit, expiry and
  one active operation. Approval refreshes the approving session without
  extending the operation or replacing its binding. Keep explicit point approvals
  for the current portal and rehearsal, and leave continuous recovery as it is.
- A version-2 signed `points` (empty value) lists at most 50 snapshots for the
  approved venue, current successful checks for the exact target only, excluding
  deleting or deleted copies. Keep a newest-first prefix within 65,536 UTF-8 bytes
  for the full response. `select` signs the point ID, checks eligibility again
  and returns the same verified metadata as `info`. Take the request lock first,
  then account, membership, saved-session proof, plan, verification policy and
  venue locks. Save the point, target and check attempt together. Same-choice
  retries reuse the saved binding. First admitted `read` freezes the choice before
  the provider grant. Accepted `restored` freezes it too.
- In `packages/account-http/src/recovery.ts`, use the existing metadata rate
  limits. Authenticate using the request key and target before returning
  `approval_required`. For `info` and `read` before selection, authenticate the
  request target and empty value before returning `selection_required`. Refuse
  unselected `restored`. Keep the read proof and post-grant checks as today.
- Backups `recovery-v2.test.ts` owns eligibility, stale listings, named-point
  approvals and read/select ordering. Account HTTP `recovery-v2.test.ts` owns
  signed routing, statuses and credential delivery. Registration’s verification
  migration test checks existing rows. Advance the migration pins and run focused
  backups recovery and both packages’ recovery qualification tests. Document the
  signed contract, refresh after a stale choice and rollout order.

Estimate 220–280 production lines and 200–260 test lines, including migration pins.

## PR 2 · Cloud approval page, after Waitron PR 6e

Update the portal recovery controller, screen, types and locale. Keep venue,
continuous choice and both confirmations. Drop the snapshot picker and show the
loss warning in English and Spanish. Add browser checks and inspect both
languages and themes at 390 and 1280 pixels. Update the operator guide and backlog.
Estimate 60–90 production lines and 60–90 test lines. Release order is Cloud server,
Waitron PR 6e, Cloud approval page.
