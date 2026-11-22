# Send box alerts and certificate reminders through Cloud email

PR 2 adds `box_alert` and `certificate_reminder` to the free Cloud relay in English and Spanish when a venue opts in and has no saved mail server. Lane G’s `questions.md` records the owner’s “Five notices” choice at 10:29 on 22 November. The three notices from #1365 and invitation, reset and email-change-code support continue. Attendance questions, clock-in reminders, daily reports and invoices stay outside this slice.

## Tests first

- In `packages/registration/test/relay-staff-notices.test.ts`, add “Box alerts and certificate reminders render in English and Spanish” and extend “version 2 accepts only the declared classes and their exact bounded facts”. Cover every alert code, both certificate stages, instructions, literal labels escaped in HTML, calendar days across a UTC date boundary and clock readings with different recorded offsets. Keep the existing malformed `box_alert` refusal. Add invalid dates, extra facts, wrong types and conditional-field refusals.
- In `packages/registration/test/relay-worker.test.ts`, add “082 preserves queued v1 mail and delivers both new v2 classes”. Reuse the populated upgrade fixture against release 081 on disposable PostgreSQL. Check that the first 81 migration records, queued ciphertext and binding survive, replay spends nothing extra, and the worker delivers the old message and both new classes to their synthetic recipients over loopback. Keep the separate 080 upgrade test and extend its exact appended-name assertion to 081 and 082. Existing signed response and allowance assertions in `packages/account-http/test/relay-messages.test.ts` cover the unchanged HTTP path. Watch the new cases fail for the expected reasons before implementing.

## Wire format and wording

Extend `packages/registration/src/relay-payload.ts` and `relay-staff-notices.ts` through the existing `relay-smtp.ts` template path. Reuse signed v2 `email-submit`, the 4,096-byte cap, common field validation, v1 replies, grant checks, exact replay, encryption and shared allowance. Lane D uses the earlier of the existing notice deadline and 24 hours after signing. Cloud writes fixed subjects and uses the existing HTML escape for body text containing caller-supplied labels.

| Class or alert code | Exact facts and wording |
| --- | --- |
| `box_alert` with `storage.space_low`, `storage.disk_full` or `clock.unusable` | `code` only. Keep the space warning, full-disk save failure and safe cleanup instructions, and the wrong-clock sales stop and recovery instructions. |
| `backup.archives_deleted` / `backup.run_stopped` | `code` plus positive integer `count`, `date`, `lastDate` for deletion, with singular, same-day and date-range wording. For a stopped backup use `neededBytes`, `availableBytes` as nonnegative integers and explain why no backup was made. |
| `upgrade.rolled_back` | `code`, `fromVersion`, `toVersion`. Bound each release label to 50 characters. The upgrade to `toVersion` failed and the box is back on `fromVersion`. Direct managers to Box status. |
| `clock.corrected` | `code`, UTC ISO `before` and `after`, `beforeOffsetMinutes` and `afterOffsetMinutes` as whole minutes within ±14 hours, signed integer `stepMs`, `source` (`admin`, `staff`, `setup`) and boolean `unverified`. Allow optional `person` for verified corrections and `device` for verified staff corrections, each a nonblank single-line label up to 80 characters. Keep source-specific wording and the unverified check-clock instruction. Use the signed step for direction and each reading’s own offset. |
| `certificate_reminder` | Real venue-calendar `date` (`YYYY-MM-DD`, also used for backup dates), `stage` (`due` or `expired`) and nonnegative integer `daysLeft` for `due` only. Name the AEAT certificate, keep the Venue settings renewal instruction and explain that after expiry sales continue while fiscal records wait. |

Waitron `main` currently hands the certificate worker rendered subject and text. Lane D must agree the structured mapping from FI10’s retained stage, `validUntil` and `timeZone`, with warning and urgent mapped to `due` and the box computing the venue date and days left. Lane D also projects the box-alert parameters onto the exact wire keys and owns the sender and setup copy. The signed proof still needs a usable clock within the existing time window, including for a wrong-clock warning. This Cloud PR stands alone and leaves Waitron and fiscal checks untouched. Sources are Waitron’s `apps/server/src/{box-alert-email,box-alert-mail,certificate-reminder-worker}.ts` and FI10’s queue plan.

## Finish

Pin release 081 at `8a01c948da6abe35b03967e9e09b3e62bc2c7465` in `packages/registration/test/fixtures/migration-release.ts`. Append `packages/registration/migrations/082_relay_box_notices.sql` in `packages/registration/src/migrate.ts` to add just the two classes. Keep 081 byte-identical. Update the current-release pins from PR 1’s plan, including the additional `billing-migration.test.ts` pin in #1365. Preserve historical assertions.

Publish the wire and rollback instructions in `docs/transactional-email-relay-contract.md`. Record the five-notice scope in `docs/backlog.md` and `docs/backlog/{venue-email,free-services}.md`. Run the named tests and affected pins, then `pnpm typecheck`. Announce readiness for `finish-branch`, which takes PR 2 through whole-branch review and current-head CI. Estimate 220–300 source lines and 120–170 test lines.

For the separate Lane D check, apply 082 on test Cloud, update all mail workers, then update HTTP before the box submits. Drain or cancel the new classes before rolling workers back. Use fresh synthetic opt-ins with `local-v1`, the existing three-per-account hourly allowance shared with account mail, and local test mail only. Production deployment stays out of scope.
