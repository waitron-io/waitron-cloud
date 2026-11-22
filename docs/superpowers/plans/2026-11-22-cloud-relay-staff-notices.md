# Send short staff notices through Cloud email

When a venue chooses Cloud email and has no saved mail server, staff can receive the old-address warning, security notices and role-change notices in English and Spanish. Cloud writes each subject and message. The box still decides whether to notify someone and which address to use. This branch supplies Cloud's side. Lane D supplies the box side and records the joint synthetic mail check.

## Signed request

Use `version: 2` for the three account notice classes on `email-submit`. Keep the existing `messageId`, `grantId`, `grantRevision`, `class`, `recipient`, `displayName` (the venue), `locale`, `timeZone` and `expiresAt`. Add one `facts` object with exact keys. Keep the 4,096-byte cap, existing recipient, locale and zone validation, and the 24-hour Cloud deadline. Lane D caps the submitted deadline at the earlier of the notice's existing deadline and 24 hours from signing. Instants use UTC ISO strings. The venue name uses the existing bound. The box trims editor and role labels to 80 characters. Cloud validates those bounds and uses the labels only in the plain-text body. Cloud rejects extra keys, including caller-supplied wording, headers and links. [Existing wire exchange](../../transactional-email-relay-contract.md#proposed-wire-exchange)

| Class | Facts |
| --- | --- |
| `email_changed` | `editorName`, `at`. The recipient is the old address. The new address is omitted. The separate security notice keeps the current recipient the box selects. |
| `security_change` | `at` from the queued time and `change` from `password_changed`, `passkey_added`, `passkey_removed`, `authenticator_set_up`, `authenticator_removed`, `recovery_codes_regenerated`, `email_changed`, `google_connected`, `google_disconnected`. |
| `role_membership_changed` | `change` (`added` or `removed`), `editorName`, `at`, and either `builtInKey` (`staff`, `supervisor`, `manager`, `admin`) or `roleName`. |

Invitations, password resets, email-change codes, status, cancel, replies and grant discovery keep version 1. Reuse signing, grant checks, encryption, exact replay and worker handoff. In the pilot, each notice uses a unit from the same allowance as account email. The current local pilot allows three per account per hour, so a batch can delay or exhaust account mail. Use synthetic venues and prove behaviour at the existing limits. [Pilot settings](../../../deploy/test-cloud/relay-settings.mjs)

Lane D confirmed the fields and expiry mapping on 22 November at 02:51. The watcher cleared the three-class slice and pilot consent at 02:14 and confirmed the cut at 02:55. Lane D names the three notices in setup and uses freshly opted-in synthetic venues for the joint check. Keep the consent version so existing grants still admit v1 mail. [Setup consent](2026-11-21-setup-email-consent.md)

Upgrade the Cloud schema, then every email worker, then the HTTP API before the box sends v2. Earlier Cloud returns `400 invalid_message` for v2 before reserving allowance. The box treats that submission as refused.

## Build and check

1. Start with failing parser and wording cases in `packages/registration/test/relay-staff-notices.test.ts`. Cover each class in both languages, with the notice time in the venue's time zone. Reject malformed or extra facts and use fixed instructions without action links. Extend `packages/registration/src/relay-payload.ts` and `relay-smtp.ts` with a versioned submit type and a Cloud-authored renderer in `relay-staff-notices.ts`. In `relay-messages.ts`, keep the existing code-expiry check scoped to the v1 code message.
2. In `packages/account-http/test/relay-messages.test.ts`, exercise one signed v2 admission and replay, changed-facts conflict, v1 status/cancel for a v2 row and no debit for a malformed notice. In `packages/registration/test/relay-worker.test.ts`, send one v2 notice through loopback with the correct recipient and text. Use the existing database fixtures and preserve the v1 cases.
3. Add release 080 (`be3df93d816aec079bdb055177da3844c9e19be2`) to `packages/registration/test/fixtures/migration-release.ts`. Queue one v1 message before upgrade and verify its ciphertext, replay and delivery afterward in the worker test. Append `packages/registration/migrations/081_relay_staff_notices.sql` in `packages/registration/src/migrate.ts` to replace `relay_messages_class_check` with the three existing classes and the three account notices. Keep prior migrations' positions and digests. Update and run the current-release pins in registration's `billing-allowance-migration`, `cloud-action-store`, `forward-observations-migration`, `mail-handoff-migration`, `mail-suppression-migration`, `migration-history`, `owner-transfer`, `registration`, `remote-name-records-migration`, `schema-compatibility`, `ses-feedback-migration`, `stable-remote-names-migration`, `staff-problem-reports` and `venue-service-migration` tests, the `fixtures/allowance-schema.ts` fixture and translation's `result-storage-upgrade` test. Use disposable PostgreSQL and run `pnpm typecheck`.
4. Publish the three-class wire format and rollout order in the [relay contract](../../transactional-email-relay-contract.md). Lane D updates the setup choice. Wait for the owner's free-plan answer before changing the [venue email backlog](../../backlog/venue-email.md) or [free-service wording](../../backlog/free-services.md).

Estimate for PR 1: 160–240 production lines and 150–220 test lines, including release-pin checks.

## PR 2, after the owner's free-plan answer

Defer the class definitions and wording for box alerts, certificate reminders and the attendance question. Daily reports stay available to print or download from Sales & takings. Invoices, sender-domain setup, real mail and production enablement are outside this work.
