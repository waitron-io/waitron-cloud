# Send short staff notices through Cloud email

When a venue chooses Cloud email and has no saved mail server, staff can receive six more notices in English and Spanish. Cloud writes each subject and message. The box still decides whether to notify someone and which address to use. This branch supplies Cloud's side. Lane D supplies the box side and records the joint synthetic mail check.

## Signed request

Use `version: 2` for the six new classes on `email-submit`. Keep the existing `messageId`, `grantId`, `grantRevision`, `class`, `recipient`, `displayName` (the venue), `locale`, `timeZone` and `expiresAt`. Add one `facts` object with exact keys. Keep the 4,096-byte cap, existing recipient, locale and zone validation, and the 24-hour Cloud deadline. Lane D caps the submitted deadline at the earlier of the notice's existing deadline and 24 hours from signing. Instants use UTC ISO strings. Calendar days use real `YYYY-MM-DD` dates. Names use the existing display-name bounds and appear in the plain-text body. Cloud rejects extra keys, including caller-supplied wording, headers and links. [Existing wire exchange](../../transactional-email-relay-contract.md#proposed-wire-exchange)

| Class | Facts |
| --- | --- |
| `email_changed` | `editorName`, `at`. The recipient is the old address. The new address is omitted. |
| `security_change` | `at` from the queued time and `change` from `password_changed`, `passkey_added`, `passkey_removed`, `authenticator_set_up`, `authenticator_removed`, `recovery_codes_regenerated`, `email_changed`, `google_connected`, `google_disconnected`. |
| `role_membership_changed` | `change` (`added` or `removed`), `editorName`, `at`, and either `builtInKey` (`staff`, `supervisor`, `manager`, `admin`) or `roleName`. |
| `box_alert` | `code` plus the exact facts listed below. |
| `certificate_reminder` | `date` in the venue's zone and `stage` (`due` or `expired`). For `due` only, add nonnegative integer `daysLeft`. The box maps warning and urgent to due using its existing calendar calculation. |
| `attendance_question` | `businessDay` and `missingKinds` (one or both of `in`, `out`, without repeats). Tell staff to correct their hours at the next clock-in. |

- `storage.space_low`, `storage.disk_full` and `clock.unusable` take only their code.
- `backup.archives_deleted` adds positive integer `count`, `date` and `lastDate`. Cloud uses the date range when the days differ. `backup.run_stopped` adds nonnegative integer `neededBytes` and `availableBytes`.
- `upgrade.rolled_back` adds `fromVersion` and `toVersion` as bounded release labels. `clock.corrected` adds `before`, `after`, `beforeOffsetMinutes`, `afterOffsetMinutes`, signed integer `stepMs`, `source` (`admin`, `staff`, `setup`) and boolean `unverified`. Offsets are whole minutes within ±14 hours. Use the step's sign for direction. On verified corrections accept optional `person`, and on verified staff corrections accept optional `device`.

Invitations, password resets, email-change codes, status, cancel, replies and grant discovery keep version 1. Reuse the existing signed request, consent and grant checks, allowance, expiry, encryption, exact replay and worker handoff. Upgrade Cloud's schema, API and worker before the box sends v2. Agree the fields and expiry mapping with Lane D before either builds.

## Build and check

1. Start with failing parser and wording cases in `packages/registration/test/relay-staff-notices.test.ts`. Cover each class and alert in both languages, including local dates, and reject malformed or extra facts. Extend `packages/registration/src/relay-payload.ts` and `relay-smtp.ts` with a versioned submit type and a Cloud-authored renderer in `relay-staff-notices.ts`. In `relay-messages.ts`, keep the existing code-expiry check scoped to the v1 code message.
2. In `packages/account-http/test/relay-messages.test.ts`, exercise one signed v2 admission and replay, changed-facts conflict, v1 status/cancel for a v2 row and no debit for a malformed notice. In `packages/registration/test/relay-worker.test.ts`, send one v2 notice through loopback with the correct recipient and text. Use the existing database fixtures and preserve the v1 cases.
3. Queue a v1 message on schema 080 using `packages/registration/test/fixtures/migration-release.ts` and verify its original ciphertext, replay and delivery after upgrade in the worker test. Append `packages/registration/migrations/081_relay_staff_notices.sql` in `packages/registration/src/migrate.ts` to widen the existing class check. Keep prior positions and digests. Update and run the affected migration-count checks, including `packages/registration/test/migration-history.test.ts`, `registration.test.ts`, `schema-compatibility.test.ts`, current-schema migration fixture checks and `packages/translation/test/result-storage-upgrade.test.ts`. Use disposable PostgreSQL and run `pnpm typecheck`.
4. Publish the wire format and update the free-service wording in the backlog. Daily reports stay available to print or download from Sales & takings. Invoices, sender-domain setup, real mail and production enablement are outside this slice. [Relay contract](../../transactional-email-relay-contract.md) · [Cloud backlog](../../backlog.md#venue-email-from-cloud-sent-as-the-venues-own-domain) · [Venue email](../../backlog/venue-email.md) · [Free services](../../backlog/free-services.md)

Estimate 350–450 production lines, 250–350 test lines and 50–80 documentation lines.
