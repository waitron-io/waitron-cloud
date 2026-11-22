# Send box alerts and certificate reminders through Cloud email

Cloud accepts two more signed notices in English and Spanish when a free-plan venue opts in without a saved mail server. The owner chose “Five notices (Recommended)” at 10:29 on 22 November, recorded by the watcher in Lane G's `questions.md`. The three #1365 notices are already available in the test pilot. The watcher cleared this design at 10:44. The Cloud change gives the test relay a receiver for both new classes. Venues can receive both classes after Lane D ships the sender. At 10:58 the watcher cleared Lane D to use the existing certificate reminder job. Attendance questions, clock-in reminders, daily reports, invoices and production use are outside this slice.

## Wire format

Reuse signed v2 `email-submit`, its common field bounds, grant checks, allowance, encryption, queue and v1 replies. The box caps expiry at the earlier of the notice deadline and 24 hours after signing. Extend `packages/registration/src/relay-payload.ts` and `relay-staff-notices.ts`. Format `facts.at` only for the three existing notices. Use fixed subjects, the existing HTML escape and blank lines between paragraphs.

| Class or alert code | Exact facts |
| --- | --- |
| `box_alert` with `storage.space_low` or `storage.disk_full` | `code` only. Keep the Box status and safe cleanup instructions. |
| `backup.archives_deleted` | `code`, positive safe integer `count`, `date`, `lastDate`. Distinguish one backup, several on one day and a range. |
| `backup.run_stopped` | `code`, nonnegative safe integers `neededBytes` and `availableBytes`. |
| `upgrade.rolled_back` | `code`, `fromVersion`, `toVersion`. Match the box host's Waitron release format and 50-character bound. Name the failed upgrade and the restored version. |
| `clock.corrected` | `code`, UTC ISO `before`, `after`, each recorded offset (`beforeOffsetMinutes`, `afterOffsetMinutes`, whole minutes within ±14 hours), signed safe integer `stepMs`, `source` (`admin`, `staff`, `setup`) and boolean `unverified`. Verified corrections may include `person`, and verified staff corrections may include `device`. Use the existing 80-code-point body label rule. The box's measured step excludes elapsed time. Keep its recorded offsets and the unverified check-clock instruction. |
| `certificate_reminder` | `date`, `stage` (`due` or `expired`), and nonnegative safe integer `daysLeft` for `due` only. Keep the AEAT renewal instruction and the effect of expiry. |

Validate calendar dates as real `YYYY-MM-DD` days and format them in UTC to preserve the stated day. A free venue without a mail server gets no unusable-clock email. The box signs with its wrong clock during that alert, outside Cloud’s 60-second proof window. Lane D confirmed the two clock offsets and rounded measured step at 10:41. Its 10:44 watcher note keeps full-disk alerts on the existing direct-email path for this slice. Cloud accepts the same code-only shape as low space. Lane D maps certificate warning and urgent to due with the venue-local calendar date and days left, and expired to expired with the date alone. Its existing reminder job can supply these values when the box sender ships.

## Build and check

1. Start with failing exact-facts and bilingual rendering cases in `packages/registration/test/relay-staff-notices.test.ts`. Cover new codes and reminder stages, stated calendar days, separate clock offsets, invalid facts and escaped labels. Keep the existing malformed `box_alert` refusal.
2. Extend the existing v2 loopback case in `packages/registration/test/relay-worker.test.ts` with each new class. Append `packages/registration/migrations/082_relay_box_notices.sql` in `packages/registration/src/migrate.ts` to widen the class list. The existing populated 080 upgrade case checks old queued mail across both migrations. Extend only its expected suffix. Keep 081 byte-identical. Update the exact pins below.
3. Update the setup wording, wire facts and rollout in `docs/transactional-email-relay-contract.md`. Update `docs/backlog.md` and `docs/backlog/{venue-email,free-services}.md` for the five-notice decision. Run the named tests, the affected pins using disposable PostgreSQL, and `pnpm typecheck`. Estimate 200–280 source, 110–160 test lines including pins, and 35–60 documentation lines.

The exact current-release pins in `packages/registration/test/` are `billing-allowance-migration.test.ts`, `billing-migration.test.ts` (delta from 044), `cloud-action-store.test.ts`, `fixtures/allowance-schema.ts`, `forward-observations-migration.test.ts`, `mail-handoff-migration.test.ts`, `mail-suppression-migration.test.ts`, `migration-history.test.ts`, `owner-transfer.test.ts`, `registration.test.ts`, `remote-name-records-migration.test.ts`, `schema-compatibility.test.ts`, `ses-feedback-migration.test.ts`, `stable-remote-names-migration.test.ts`, `staff-problem-reports.test.ts` and `venue-service-migration.test.ts`. Update `packages/translation/test/result-storage-upgrade.test.ts` too.

For the joint synthetic inbox check, upgrade the schema and workers before the API and box sender. Drain or cancel new-class mail before rolling workers back. Use fresh opt-ins, the same consent version and the existing allowance of three messages per account per hour. Wider rollout still needs a consent decision.
